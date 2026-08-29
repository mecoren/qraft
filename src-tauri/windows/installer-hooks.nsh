; ============================================================
; Qraft NSIS 安装器钩子(tauri.conf.json → bundle.windows.nsis.installerHooks)
;
; 参考 VS Code 的 Windows 右键集成,安装完成后自动注册:
;   1. 任意文件右键菜单:「用 Qraft 打开」(Software\Classes\*\shell\Qraft)
;   2. 文件夹右键菜单(Software\Classes\Directory\shell\Qraft)
;   3. 文件夹空白处右键菜单(Directory\Background,命令参数用 %V)
;   4. Software\Classes\Applications 登记,使「打开方式…」列表出现 Qraft
; 卸载时(PREUNINSTALL)将以上注册表项全部清除。
;
; 说明:
; - installMode=currentUser,SHCTX 在运行时解析为 HKCU,无需管理员权限;
;   若未来改为 perMachine,SHCTX 自动切换为 HKLM,同样正确。
; - 本文件含中文文案,必须保存为 UTF-8(BOM)编码,makensis 才能正确解析。
; ============================================================

;; 在指定 Classes 键下写入「用 Qraft 打开」动词
;; ${_KEY}:Software\Classes 下的子键(如 * 或 Directory)
;; ${_ARG }:传给主程序的占位参数("%1" 或 "%V")
!macro _Qraft_WriteOpenKey _KEY _ARG
  WriteRegStr SHCTX "Software\Classes\${_KEY}\shell\Qraft" "" "用 Qraft 打开"
  WriteRegStr SHCTX "Software\Classes\${_KEY}\shell\Qraft" "Icon" "$INSTDIR\${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "Software\Classes\${_KEY}\shell\Qraft\command" "" `"$INSTDIR\${MAINBINARYNAME}.exe" ${_ARG}`
!macroend

;; 覆盖写入文件关联 ProgID 的专属类型图标。
;; 模板默认把所有类型的 DefaultIcon 统一指向主程序 exe,导致资源管理器中
;; 各类型文件全部显示应用图标;此处按类型改写为 $INSTDIR\icons\file-assoc\ 下的 ICO。
;; ProgID 名称须与 tauri.conf.json → bundle.fileAssociations[].name 严格一致。
!macro _Qraft_AssocTypeIcon _FILECLASS _ICON
  WriteRegStr SHCTX "Software\Classes\${_FILECLASS}\DefaultIcon" "" "$INSTDIR\icons\file-assoc\${_ICON},0"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ---- 右键菜单动词(文件 / 文件夹 / 空白处)----
  !insertmacro _Qraft_WriteOpenKey "*" '"%1"'
  !insertmacro _Qraft_WriteOpenKey "Directory" '"%1"'
  !insertmacro _Qraft_WriteOpenKey "Directory\Background" '"%V"'

  ; ---- 「打开方式…」应用列表(参考 VS Code 登记 Code.exe 的做法)----
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" `"$INSTDIR\${MAINBINARYNAME}.exe" "%1"`

  ; ---- 各文件类型的专属图标 ----
  ; 图标 = material-icon-theme 同源 SVG 生成的 ICO(scripts/generate-file-icons.mjs),
  ; 与应用内「打开的编辑器」标签栏图标(fileIcons.ts)一一对应。
  !insertmacro _Qraft_AssocTypeIcon "Text Document" "file.ico"
  !insertmacro _Qraft_AssocTypeIcon "JSON Document" "json.ico"
  !insertmacro _Qraft_AssocTypeIcon "Markdown Document" "markdown.ico"
  !insertmacro _Qraft_AssocTypeIcon "CSV Document" "table.ico"
  !insertmacro _Qraft_AssocTypeIcon "Log File" "log.ico"
  !insertmacro _Qraft_AssocTypeIcon "XML Document" "xml.ico"
  !insertmacro _Qraft_AssocTypeIcon "YAML Document" "yaml.ico"
  !insertmacro _Qraft_AssocTypeIcon "TOML Document" "toml.ico"
  !insertmacro _Qraft_AssocTypeIcon "Configuration Text File" "settings.ico"
  !insertmacro _Qraft_AssocTypeIcon "JavaScript Document" "javascript.ico"
  !insertmacro _Qraft_AssocTypeIcon "TypeScript Document" "typescript.ico"
  !insertmacro _Qraft_AssocTypeIcon "React Document" "react.ico"
  !insertmacro _Qraft_AssocTypeIcon "Python Document" "python.ico"
  !insertmacro _Qraft_AssocTypeIcon "Rust Document" "rust.ico"
  !insertmacro _Qraft_AssocTypeIcon "Go Document" "go.ico"
  !insertmacro _Qraft_AssocTypeIcon "Java Document" "java.ico"
  !insertmacro _Qraft_AssocTypeIcon "C Document" "c.ico"
  !insertmacro _Qraft_AssocTypeIcon "C++ Document" "cpp.ico"
  !insertmacro _Qraft_AssocTypeIcon "Shell Script Document" "console.ico"
  !insertmacro _Qraft_AssocTypeIcon "SQL Document" "database.ico"
  !insertmacro _Qraft_AssocTypeIcon "Vue Document" "vue.ico"
  !insertmacro _Qraft_AssocTypeIcon "Svelte Document" "svelte.ico"

  ; ---- 清理历史版本遗留的分组 ProgID(源代码文件统一图标已被按语言拆分取代)----
  DeleteRegKey SHCTX "Software\Classes\Source Code File"

  ; ---- 通知资源管理器刷新图标/关联缓存(SHCNE_ASSOCCHANGED)----
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\Qraft"
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\Qraft"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Qraft"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  ; 历史版本遗留的分组 ProgID
  DeleteRegKey SHCTX "Software\Classes\Source Code File"
!macroend
