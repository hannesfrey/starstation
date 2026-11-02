; Starstation installer additions (electron-builder NSIS).
; Layout: <folder>\Starstation\Starstation.lnk + <folder>\Starstation\Files\app (the program).
; The uninstaller removes INSTDIR, so INSTDIR is always ...\Files\app — games, saves and everything
; else in Files\ are never inside it and always survive an uninstall.

!macro preInit
  ; default location Desktop\Starstation (a reinstall keeps the folder chosen before)
  SetRegView 64
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" 0 +2
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$DESKTOP\Starstation\Files\app"
  SetRegView 32
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" 0 +2
    WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$DESKTOP\Starstation\Files\app"
!macroend

; after the folder page: whatever folder was picked, the program goes into <folder>\Starstation\Files\app
!macro customPageAfterChangeDir
  Page custom starstationFixDir
  Function starstationFixDir
    StrCpy $0 "$INSTDIR" "" -10
    StrCmp $0 "\Files\app" done
    StrCpy $1 "$INSTDIR" "" -12
    StrCmp $1 "\Starstation" 0 +3
      StrCpy $INSTDIR "$INSTDIR\Files\app"
      Goto done
    StrCpy $INSTDIR "$INSTDIR\Starstation\Files\app"
    done:
    Abort ; nothing to show: this "page" only fixes the folder
  FunctionEnd
!macroend

!macro customInstall
  ; shortcut in the Starstation folder (two levels above Files\app)
  StrCpy $R1 "$INSTDIR" -10
  CreateShortCut "$R1\Starstation.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  ; electron-builder keeps a copy of the installer in %LOCALAPPDATA% for smaller updates; Starstation keeps
  ; everything in its own folder, so remove it (updates then download in full, into Files\config\electron)
  Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
  RMDir "$LOCALAPPDATA\starstation-updater"
!macroend

!macro customUnInstall
  ; an update reinstalls right away: keep the shortcut then
  ${ifNot} ${isUpdated}
    StrCpy $R1 "$INSTDIR" -10
    Delete "$R1\Starstation.lnk"
  ${endIf}
!macroend
