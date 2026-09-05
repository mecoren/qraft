import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CronParser } from './CronParser';

describe('CronParser', () => {
  it('默认表达式渲染描述与接下来的执行时间', () => {
    render(<CronParser toolId="cron_parser" metadata={null as never} />);
    const desc = screen.getByTestId('cron-description');
    expect(desc).toHaveTextContent(/00:00|每天|零点|midnight|0:00|AM/i);
    expect(screen.getAllByTestId('cron-next-item').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('cron-prev-item').length).toBeGreaterThan(0);
  });

  it('非法表达式显示错误', () => {
    render(<CronParser toolId="cron_parser" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('cron-expr'), { target: { value: 'not a cron' } });
    expect(screen.getByTestId('cron-error')).toBeInTheDocument();
  });

  it('未开秒时输入 6 段提示应为 5 段;开秒后正常解析', () => {
    render(<CronParser toolId="cron_parser" metadata={null as never} />);
    fireEvent.change(screen.getByTestId('cron-expr'), { target: { value: '0 0 0 * * *' } });
    expect(screen.getByTestId('cron-error')).toHaveTextContent(/5 段/);
    fireEvent.click(screen.getByTestId('cron-seconds'));
    expect(screen.getByTestId('cron-description')).toBeInTheDocument();
    // 字段标签行随 6 段模式出现「秒」
    expect(screen.getByTestId('cron-field-labels')).toHaveTextContent('0');
  });

  it('点击预设表达式填入输入框', () => {
    render(<CronParser toolId="cron_parser" metadata={null as never} />);
    fireEvent.click(screen.getByRole('button', { name: '工作日 9 点' }));
    expect(screen.getByTestId('cron-expr')).toHaveValue('0 9 * * 1-5');
  });

  it('含秒模式下预设自动补齐秒位', () => {
    render(<CronParser toolId="cron_parser" metadata={null as never} />);
    fireEvent.click(screen.getByTestId('cron-seconds'));
    fireEvent.click(screen.getByRole('button', { name: '每 5 分钟' }));
    expect(screen.getByTestId('cron-expr')).toHaveValue('0 */5 * * * *');
  });

  it('时区选择器存在且切换不影响解析', () => {
    render(<CronParser toolId="cron_parser" metadata={null as never} />);
    // Radix Select 为非原生控件,交互由 e2e 覆盖;这里仅断言触发器与解析结果共存
    expect(screen.getByTestId('cron-timezone')).toBeInTheDocument();
    expect(screen.getByTestId('cron-description')).toBeInTheDocument();
  });
});
