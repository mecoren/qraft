import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Ipv4SubnetCalculator } from './Ipv4SubnetCalculator';
import { parseCidr } from './ipv4-subnet-utils';

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
});
