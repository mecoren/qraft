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
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\*\shell\Qraft"
  DeleteRegKey SHCTX "Software\Classes\Directory\shell\Qraft"
  DeleteRegKey SHCTX "Software\Classes\Directory\Background\shell\Qraft"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
!macroend
