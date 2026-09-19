// 外部文件变更监视器(notify 封装)
//
// 编辑器把「当前打开且已授权」的文件路径注册进来;任一文件被其它程序改写 /
// 删除 / 重建时,监视线程按路径去抖后回调一次,Shell 层把回调转成
// `fs:external-change` 事件推给前端。
//
// 两条刻意的简化:
// 1. 事件载荷只有路径,没有变更类型/新 mtime。notify 各后端(win/mac/linux)
//    的事件语义差异很大,判型留在前端:拿到通知后按 Tab 记录的打开时基准
//    重新 stat,一致就是「无事发生」。本应用自己写盘也会触发事件,而保存流程
//    已把基准刷成新 mtime,因此同一条规则顺带滤掉了自写噪音。
// 2. 监视目标是文件的**父目录**,再按路径键过滤。直接 watch 文件在
//    「删除后重建」时会随 inode 一起失效(Windows 重命名同理),watch 父目录
//    才能持续收到该文件的事件;同目录其它文件的改动在过滤阶段丢弃。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::PoisonError;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};

/// 同一路径连续事件的去抖窗口:一次外部保存通常连发 2~4 个事件,
/// 只放行第一个,避免前端被同一改动刷出一串提示。
const DEBOUNCE: Duration = Duration::from_millis(500);

/// 变更通知回调(由 Shell 层注入,内部做 Tauri `emit`)
type Sink = dyn Fn(String) + Send + Sync + 'static;

/// 路径比较键:Windows/macOS 文件系统大小写不敏感,同一文件的不同写法必须
/// 归并成一个键,否则过滤会漏掉事件
fn path_key(path: &Path) -> String {
    let raw = path.to_string_lossy().into_owned();
    if cfg!(any(windows, target_os = "macos")) {
        raw.to_lowercase()
    } else {
        raw
    }
}

/// 去抖判定:距上次放行超过 `window` 才放行,并刷新放行时间。
/// `now` 由调用方传入,便于测试推进虚拟时间。
fn should_forward(
    fired: &mut HashMap<String, Instant>,
    key: &str,
    now: Instant,
    window: Duration,
) -> bool {
    if let Some(prev) = fired.get(key) {
        if now.duration_since(*prev) < window {
            return false;
        }
    }
    fired.insert(key.to_owned(), now);
    true
}

/// 注册表:待通知的文件 + 实际向 notify 注册的父目录
#[derive(Default)]
struct Registry {
    /// 文件路径键 → 注册时收到的原始路径字符串(事件载荷原样回传,前端自行比对)
    files: HashMap<String, String>,
    /// 已注册的父目录:键同上,值保留原始 `PathBuf` 供 unwatch
    dirs: HashMap<String, PathBuf>,
}

/// watcher 线程与命令线程共享的状态(全部逻辑都在这里,不碰 Tauri 类型)
struct WatchState {
    registry: Mutex<Registry>,
    fired: Mutex<HashMap<String, Instant>>,
    sink: Box<Sink>,
}

impl WatchState {
    fn new(sink: Box<Sink>) -> Self {
        Self {
            registry: Mutex::new(Registry::default()),
            fired: Mutex::new(HashMap::new()),
            sink,
        }
    }

    /// 用新的文件集合替换旧集合,返回需要新增 / 需要解除的父目录。
    /// 注册表先落定再操作 watcher,期间的竞态事件最多被多滤或多放一次,
    /// 判定权在前端 stat,无害。
    fn replace(&self, paths: &[PathBuf]) -> (Vec<PathBuf>, Vec<PathBuf>) {
        let mut next = Registry::default();
        for path in paths {
            next.files
                .insert(path_key(path), path.to_string_lossy().into_owned());
            if let Some(dir) = path.parent().filter(|d| !d.as_os_str().is_empty()) {
                next.dirs
                    .entry(path_key(dir))
                    .or_insert_with(|| dir.to_path_buf());
            }
        }
        let (to_watch, to_unwatch) = {
            let mut current = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
            let to_watch: Vec<PathBuf> = next
                .dirs
                .iter()
                .filter(|(key, _)| !current.dirs.contains_key(*key))
                .map(|(_, dir)| dir.clone())
                .collect();
            let to_unwatch: Vec<PathBuf> = current
                .dirs
                .iter()
                .filter(|(key, _)| !next.dirs.contains_key(*key))
                .map(|(_, dir)| dir.clone())
                .collect();
            *current = next;
            drop(current);
            (to_watch, to_unwatch)
        };
        // 目录换了一批,旧的去抖时间戳对新集合没有意义,直接清空
        if !to_unwatch.is_empty() {
            let mut fired = self.fired.lock().unwrap_or_else(PoisonError::into_inner);
            fired.clear();
        }
        (to_watch, to_unwatch)
    }

    /// 当前注册的文件路径集合(诊断与测试用)
    fn registered(&self) -> Vec<String> {
        let mut paths: Vec<String> = self
            .registry
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .files
            .values()
            .cloned()
            .collect();
        paths.sort();
        paths
    }

    /// 筛出本轮该通知的原始路径:命中注册表 + 过了去抖窗口
    fn collect_pending(&self, paths: &[PathBuf], now: Instant) -> Vec<String> {
        let registry = self.registry.lock().unwrap_or_else(PoisonError::into_inner);
        if registry.files.is_empty() {
            return Vec::new();
        }
        let mut fired = self.fired.lock().unwrap_or_else(PoisonError::into_inner);
        let mut pending = Vec::new();
        for path in paths {
            let key = path_key(path);
            let Some(original) = registry.files.get(&key) else {
                continue;
            };
            if !should_forward(&mut fired, &key, now, DEBOUNCE) {
                continue;
            }
            pending.push(original.clone());
        }
        drop(fired);
        drop(registry);
        pending
    }

    /// notify 回调入口。先出锁再回调:`emit` 是外部代码,不该持有注册表锁执行。
    fn handle_paths(&self, paths: &[PathBuf], now: Instant) {
        for original in self.collect_pending(paths, now) {
            (self.sink)(original);
        }
    }
}

/// 进程内文件监视器
///
/// 生命周期与窗口无关:注册表为空时 watcher 仍保留,前端切 Tab 只是改集合,
/// 不必反复销毁重建原生监视器。
pub struct FsWatchHub {
    state: Arc<WatchState>,
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl FsWatchHub {
    #[must_use]
    pub fn new(sink: impl Fn(String) + Send + Sync + 'static) -> Self {
        Self {
            state: Arc::new(WatchState::new(Box::new(sink))),
            watcher: Mutex::new(None),
        }
    }

    /// 惰性创建原生 watcher(已创建则直接返回)
    ///
    /// # Errors
    ///
    /// 原生后端初始化失败时返回其错误说明。
    fn ensure_watcher(&self) -> Result<(), String> {
        let mut guard = self.watcher.lock().unwrap_or_else(PoisonError::into_inner);
        if guard.is_some() {
            return Ok(());
        }
        let state = Arc::clone(&self.state);
        let created = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                state.handle_paths(&event.paths, Instant::now());
            }
        })
        .map_err(|e| e.to_string())?;
        *guard = Some(created);
        drop(guard);
        Ok(())
    }

    /// 用新的文件集合替换当前注册集合(前端在 Tab 集合变化时全量下发)。
    ///
    /// # Errors
    ///
    /// - 原生 watcher 创建失败时返回其错误说明
    /// - 单个目录注册失败(目录恰被移除等)只跳过该目录 —— 漏掉推送的兜底
    ///   是前端的激活轮询
    pub fn replace(&self, paths: &[PathBuf]) -> Result<(), String> {
        let (to_watch, to_unwatch) = self.state.replace(paths);
        if to_watch.is_empty() && to_unwatch.is_empty() {
            return Ok(());
        }
        self.ensure_watcher()?;
        let mut guard = self.watcher.lock().unwrap_or_else(PoisonError::into_inner);
        let watcher = guard
            .as_mut()
            .ok_or_else(|| "file watcher unavailable".to_string())?;
        for dir in &to_unwatch {
            let _ = watcher.unwatch(dir);
        }
        for dir in &to_watch {
            let _ = watcher.watch(dir, RecursiveMode::NonRecursive);
        }
        drop(guard);
        Ok(())
    }

    /// 当前注册的文件路径集合(诊断与测试用)
    #[must_use]
    pub fn registered(&self) -> Vec<String> {
        self.state.registered()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn tmp_file(dir: &Path, name: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, b"x").expect("write fixture");
        path
    }

    fn recorded() -> (Arc<StdMutex<Vec<String>>>, Box<Sink>) {
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let sink = {
            let seen = Arc::clone(&seen);
            Box::new(move |path: String| {
                if let Ok(mut g) = seen.lock() {
                    g.push(path);
                }
            }) as Box<Sink>
        };
        (seen, sink)
    }

    #[test]
    fn forwards_only_registered_paths() {
        let dir = tempfile::TempDir::new().unwrap();
        let watched = tmp_file(dir.path(), "a.txt");
        let other = tmp_file(dir.path(), "b.txt");
        let (seen, sink) = recorded();
        let state = WatchState::new(sink);
        state.replace(std::slice::from_ref(&watched));
        state.handle_paths(&[other, watched.clone()], Instant::now());
        assert_eq!(
            *seen.lock().unwrap(),
            vec![watched.to_string_lossy().into_owned()]
        );
    }

    #[test]
    fn debounces_repeated_events_for_one_path() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = tmp_file(dir.path(), "a.txt");
        let (seen, sink) = recorded();
        let state = WatchState::new(sink);
        state.replace(std::slice::from_ref(&path));
        let t0 = Instant::now();
        // 同一次外部保存连发的事件落在去抖窗口内:只通知一次
        state.handle_paths(std::slice::from_ref(&path), t0);
        state.handle_paths(std::slice::from_ref(&path), t0 + Duration::from_millis(200));
        assert_eq!(seen.lock().unwrap().len(), 1);
        // 窗口之后再发仍然通知(第二次真实改动不该被吞掉)
        state.handle_paths(std::slice::from_ref(&path), t0 + DEBOUNCE * 2);
        assert_eq!(seen.lock().unwrap().len(), 2);
    }

    #[test]
    fn replace_watches_parents_and_unwatches_dropped_dirs() {
        let first = tempfile::TempDir::new().unwrap();
        let second = tempfile::TempDir::new().unwrap();
        let a = tmp_file(first.path(), "a.txt");
        let b = tmp_file(second.path(), "b.txt");
        let (_, sink) = recorded();
        let state = WatchState::new(sink);

        let (to_watch, to_unwatch) = state.replace(std::slice::from_ref(&a));
        assert_eq!(to_watch, vec![first.path().to_path_buf()]);
        assert!(to_unwatch.is_empty());
        // 同目录再加一个文件:父目录已注册,无增量
        let same_dir_extra = tmp_file(first.path(), "c.txt");
        let (to_watch, to_unwatch) = state.replace(&[a, same_dir_extra]);
        assert!(to_watch.is_empty());
        assert!(to_unwatch.is_empty());
        // 换到另一个目录:旧目录解除,新目录注册
        let (to_watch, to_unwatch) = state.replace(std::slice::from_ref(&b));
        assert_eq!(to_watch, vec![second.path().to_path_buf()]);
        assert_eq!(to_unwatch, vec![first.path().to_path_buf()]);
        assert_eq!(state.registered(), vec![b.to_string_lossy().into_owned()]);
    }

    #[test]
    fn empty_registration_clears_everything() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = tmp_file(dir.path(), "a.txt");
        let (seen, sink) = recorded();
        let state = WatchState::new(sink);
        state.replace(std::slice::from_ref(&path));
        let (to_watch, to_unwatch) = state.replace(&[]);
        assert!(to_watch.is_empty());
        assert_eq!(to_unwatch, vec![dir.path().to_path_buf()]);
        assert!(state.registered().is_empty());
        // 集合清空后事件不再外泄
        state.handle_paths(std::slice::from_ref(&path), Instant::now());
        assert!(seen.lock().unwrap().is_empty());
    }

    #[test]
    fn path_key_folds_case_where_filesystem_does() {
        let path = Path::new("/Tmp/A.Txt");
        let key = path_key(path);
        if cfg!(any(windows, target_os = "macos")) {
            assert_eq!(key, "/tmp/a.txt");
        } else {
            assert_eq!(key, "/Tmp/A.Txt");
        }
    }

    #[test]
    fn hub_replace_registers_and_clears() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = tmp_file(dir.path(), "a.txt");
        let hub = FsWatchHub::new(|_path: String| {});
        hub.replace(std::slice::from_ref(&path)).unwrap();
        assert_eq!(hub.registered(), vec![path.to_string_lossy()]);
        // 全量清空可重复调用,不残留目录注册
        hub.replace(&[]).unwrap();
        assert!(hub.registered().is_empty());
    }

    /// 真·原生监视端到端:注册后改写文件(模拟外部程序写入),应收到路径通知。
    ///
    /// 覆盖的是 notify 后端可用性与父目录过滤这两处假设,纯逻辑用例证不到;
    /// 原生事件投递有平台差异与时序抖动,故按 250ms 步进重写重试,上限 5s。
    #[test]
    fn notifies_on_external_write() {
        use std::sync::mpsc;

        let dir = tempfile::TempDir::new().unwrap();
        let path = tmp_file(dir.path(), "a.txt");
        let (tx, rx) = mpsc::channel::<String>();
        let hub = FsWatchHub::new(move |p| {
            let _ = tx.send(p);
        });
        hub.replace(std::slice::from_ref(&path)).unwrap();

        let expected = path.to_string_lossy().into_owned();
        for attempt in 0..20 {
            std::fs::write(&path, format!("external write #{attempt}")).expect("external write");
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(received) => {
                    assert_eq!(received, expected);
                    return;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
        panic!("5s 内未收到 {expected} 的外部变更事件");
    }
}
