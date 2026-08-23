// 网络访问模块(受控白名单)
//
// 零网络原则的登记例外(PRD 13-security.md §3.1):
// - 自动更新(tauri-plugin-updater,唯一自动例外)
// - IP 归属地查询(`ip_lookup` command):仅允许访问本模块内
//   硬编码白名单域名(ip-api.com / flagcdn.com),且必须由用户
//   显式点击按钮触发,不自动发起、无遥测。

pub mod ip_lookup;
