use std::path::Path;

fn main() {
    // bench 二进制同样链接 commands 模块(tauri-plugin-dialog → rfd 的
    // common-controls-v6 会静态导入 comctl32 v6 的 TaskDialogIndirect),
    // 但 tauri_build 只为主二进制嵌入 manifest——无 manifest 的 bench exe 会被
    // loader 绑到 WinSxS 的 comctl32 5.82(不导出该函数),启动即
    // STATUS_ENTRYPOINT_NOT_FOUND。给全部 bench 目标补嵌
    // benches/bench.manifest(仅声明 Common-Controls v6 依赖)。
    #[cfg(all(target_os = "windows", target_env = "msvc"))]
    {
        let manifest = Path::new("benches/bench.manifest")
            .canonicalize()
            .map_or_else(
                |_| "benches/bench.manifest".into(),
                |p| p.display().to_string(),
            );
        println!("cargo:rustc-link-arg-benches=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-benches=/MANIFESTINPUT:{manifest}");
    }
    tauri_build::build();
}
