import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Ipv4SubnetCalculator } from './Ipv4SubnetCalculator';
import { parseCidr, splitSubnet } from './ipv4-subnet-utils';

describe('parseCidr', () => {
  it('/24 解析网络地址/掩码/反掩码/广播/可用主机范围与数量', () => {
    const r = parseCidr('192.168.1.10/24');
    expect(r).not.toBeNull();
    expect(r!.network).toBe('192.168.1.0');
    expect(r!.netmask).toBe('255.255.255.0');
    expect(r!.wildcard).toBe('0.0.0.255');
    expect(r!.broadcast).toBe('192.168.1.255');
    expect(r!.firstHost).toBe('192.168.1.1');
    expect(r!.lastHost).toBe('192.168.1.254');
    expect(r!.usableHosts).toBe(254);
  });

  it('省略前缀按 /32;/31 点对点可用数为 2', () => {
    expect(parseCidr('10.0.0.5')!.usableHosts).toBe(1);
    expect(parseCidr('10.0.0.5/31')!.usableHosts).toBe(2);
    expect(parseCidr('10.0.0.5/31')!.firstHost).toBe('10.0.0.4');
  });

  it('/0 全网段', () => {
    const r = parseCidr('0.0.0.0/0')!;
    expect(r.network).toBe('0.0.0.0');
    expect(r.broadcast).toBe('255.255.255.255');
    expect(r.usableHosts).toBe(2 ** 32 - 2);
  });

  it('非法输入返回 null', () => {
    expect(parseCidr('999.1.1.1/24')).toBeNull();
    expect(parseCidr('abc')).toBeNull();
    expect(parseCidr('1.2.3.4/33')).toBeNull();
    expect(parseCidr('1.2.3')).toBeNull();
    expect(parseCidr('1.2.3.-1/8')).toBeNull();
  });

  it('接受点分掩码形态(空格或斜杠分隔),非连续掩码拒绝', () => {
    const spaced = parseCidr('192.168.1.130 255.255.255.192')!;
    expect(spaced.network).toBe('192.168.1.128');
    expect(spaced.prefix).toBe(26);
    const slashed = parseCidr('10.0.0.5/255.255.0.0')!;
    expect(slashed.network).toBe('10.0.0.0');
    expect(slashed.prefix).toBe(16);
    expect(parseCidr('1.2.3.4 255.0.255.0')).toBeNull();
  });

  it('拒绝前导零八位组', () => {
    expect(parseCidr('010.0.0.1/8')).toBeNull();
    expect(parseCidr('192.168.01.1')).toBeNull();
  });

  it('携带输入 IP/前缀/主机位/二进制信息', () => {
    const r = parseCidr('192.168.1.10/24')!;
    expect(r.ip).toBe('192.168.1.10');
    expect(r.prefix).toBe(24);
    expect(r.binaryIp).toBe('11000000.10101000.00000001.00001010');
    expect(r.binaryMask).toBe('11111111.11111111.11111111.00000000');
  });
});

describe('splitSubnet', () => {
  it('按新前缀划分子网并给出数量与可用主机', () => {
    const base = 0xc0a80100; // 192.168.1.0
    const r = splitSubnet(base, 24, 26)!;
    expect(r.subnetCount).toBe(4);
    expect(r.usablePerSubnet).toBe(62);
    expect(r.subnets).toHaveLength(4);
    expect(r.subnets[0]!.network).toBe('192.168.1.0');
    expect(r.subnets[3]!.network).toBe('192.168.1.192');
    expect(r.subnets[3]!.lastHost).toBe('192.168.1.254');
  });

  it('新前缀非法返回 null;/31 划分无广播扣除', () => {
    expect(splitSubnet(0x0a000000, 24, 24)).toBeNull();
    expect(splitSubnet(0x0a000000, 24, 33)).toBeNull();
    const r = splitSubnet(0x0a000000, 30, 31)!;
    expect(r.usablePerSubnet).toBe(2);
    expect(r.subnets[0]!.firstHost).toBe('10.0.0.0');
  });
});

describe('Ipv4SubnetCalculator', () => {
  it('输入 CIDR 渲染关键行', () => {
    render(<Ipv4SubnetCalculator toolId="ipv4_subnet_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('CIDR'), { target: { value: '10.0.0.1/8' } });
    expect(screen.getByTestId('subnet-network')).toHaveTextContent('10.0.0.0/8');
    expect(screen.getByTestId('subnet-hosts')).toHaveTextContent('16,777,214');
  });

  it('非法输入显示告警', () => {
    render(<Ipv4SubnetCalculator toolId="ipv4_subnet_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('CIDR'), { target: { value: 'not-an-ip' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('接受点分掩码输入并渲染分类/二进制行', () => {
    render(<Ipv4SubnetCalculator toolId="ipv4_subnet_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('CIDR'), {
      target: { value: '192.168.1.130 255.255.255.192' },
    });
    expect(screen.getByTestId('subnet-network')).toHaveTextContent('192.168.1.128/26');
    expect(screen.getByTestId('subnet-class')).toBeInTheDocument();
    expect(screen.getByTestId('subnet-scope')).toBeInTheDocument();
  });

  it('子网划分预览:默认新前缀为当前前缀+1', () => {
    render(<Ipv4SubnetCalculator toolId="ipv4_subnet_calculator" metadata={null as never} />);
    fireEvent.change(screen.getByLabelText('CIDR'), { target: { value: '192.168.1.0/24' } });
    expect(screen.getByTestId('subnet-split')).toBeInTheDocument();
    expect(screen.getByTestId('subnet-split-count')).toHaveTextContent('2');
    const items = screen.getAllByTestId('subnet-split-item');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('192.168.1.0/25');
    expect(items[1]).toHaveTextContent('192.168.1.128/25');
  });
});
