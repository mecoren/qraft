// 在 release 模式下隐藏 Windows 控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Err(e) = qraft_lib::run() {
        eprintln!("fatal error: {e:#}");
        std::process::exit(1);
    }
}
