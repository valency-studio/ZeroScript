; SPDX-License-Identifier: GPL-3.0-or-later
; ZeroScript Bridge - Windows installer (NSIS).
; Built by packaging/build.py on the windows-latest CI runner:
;   makensis /DVERSION=<ver> installers/windows.nsi   (from packaging/)
; Relative paths resolve against THIS script's directory (packaging/installers/),
; so "../../dist/..." means <repo>/dist/....
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define APPNAME "ZeroScript"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\ZeroScript"

Name "ZeroScript"
OutFile "..\..\dist\packages\ZeroScript-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\ZeroScript"
InstallDirRegKey HKCU "${UNINSTKEY}" "InstallLocation"
RequestExecutionLevel user
ShowInstDetails show
ShowUninstDetails show

; --- UI ---------------------------------------------------------------------
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\ZeroScriptBridge.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Start ZeroScript Bridge now"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; --- Install ----------------------------------------------------------------
Section "ZeroScript" SecMain
  SetOutPath "$INSTDIR"

  ; The staged portable folder: ZeroScriptBridge.exe, launch_studio_mcp.exe,
  ; config.json, zeroscript-extension/ and README.txt.
  File /r "..\..\dist\ZeroScript\*"

  ; Shortcuts.
  CreateDirectory "$SMPROGRAMS\ZeroScript"
  CreateShortcut "$SMPROGRAMS\ZeroScript\ZeroScript Bridge.lnk" "$INSTDIR\ZeroScriptBridge.exe"
  CreateShortcut "$SMPROGRAMS\ZeroScript\Extension Folder.lnk" "$INSTDIR\zeroscript-extension"
  CreateShortcut "$SMPROGRAMS\ZeroScript\Uninstall ZeroScript.lnk" "$INSTDIR\Uninstall ZeroScript.exe"
  CreateShortcut "$DESKTOP\ZeroScript Bridge.lnk" "$INSTDIR\ZeroScriptBridge.exe"

  ; Uninstaller + registry entry.
  WriteUninstaller "$INSTDIR\Uninstall ZeroScript.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "ZeroScript"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "ZeroScript"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Uninstall ZeroScript.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" "$0"
SectionEnd

; --- Uninstall --------------------------------------------------------------
Section "Uninstall"
  ; Stop a running bridge first so its exe is not locked.
  nsExec::Exec "taskkill /F /IM ZeroScriptBridge.exe"
  nsExec::Exec "taskkill /F /IM launch_studio_mcp.exe"

  Delete "$SMPROGRAMS\ZeroScript\ZeroScript Bridge.lnk"
  Delete "$SMPROGRAMS\ZeroScript\Extension Folder.lnk"
  Delete "$SMPROGRAMS\ZeroScript\Uninstall ZeroScript.lnk"
  Delete "$DESKTOP\ZeroScript Bridge.lnk"
  RMDir "$SMPROGRAMS\ZeroScript"

  DeleteRegKey HKCU "${UNINSTKEY}"
  RMDir /r "$INSTDIR"
SectionEnd
