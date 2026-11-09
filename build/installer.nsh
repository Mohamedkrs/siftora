; Siftora installer additions (electron-builder includes this file, see electron-builder.yml).

; Finish page: launch Siftora (as electron-builder's own page does), view the README, and links
; to the changelog and to support the project. URLs use plain ExecShell like MUI's own link:
; StdUtils.ExecShellAsUser silently did nothing when called from these page callbacks.
!macro customFinishPage
  Function StartApp
    ${if} ${isUpdated}
      StrCpy $1 "--updated"
    ${else}
      StrCpy $1 ""
    ${endif}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd

  Function siftoraOpenReadme
    ExecShell "open" "https://github.com/Mohamedkrs/siftora#readme"
  FunctionEnd

  Function siftoraOpenChangelog
    ExecShell "open" "https://github.com/Mohamedkrs/siftora/releases"
  FunctionEnd

  Function siftoraOpenSupport
    ExecShell "open" "https://ko-fi.com/mohamedkrs"
  FunctionEnd

  Function siftoraFinishShow
    ${NSD_CreateLink} 120u 160u 195u 10u "What's new in this version (changelog)"
    Pop $0
    SetCtlColors $0 "000080" "${MUI_BGCOLOR}"
    ${NSD_OnClick} $0 siftoraOpenChangelog
    ${NSD_CreateLink} 120u 175u 195u 10u "Support the project on Ko-fi"
    Pop $0
    SetCtlColors $0 "000080" "${MUI_BGCOLOR}"
    ${NSD_OnClick} $0 siftoraOpenSupport
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "View the README"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "siftoraOpenReadme"
  !define MUI_FINISHPAGE_SHOWREADME_NOTCHECKED
  !define MUI_PAGE_CUSTOMFUNCTION_SHOW "siftoraFinishShow"
  !insertmacro MUI_PAGE_FINISH
!macroend

; On a real uninstall, ask whether to delete the app's data folder: settings, jobs and the
; downloaded engines and models (often several GB). Updates run the uninstaller too, with
; --updated, and must never lose data, so they skip this. Silent uninstalls keep the data.
; Rendered reels live in the user's Videos folder and are never touched; models linked from
; Ollama or elsewhere stay where they are, since only their paths are stored here.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 \
      "Also delete Siftora's downloaded models, engines and settings?$\r$\n$\r$\nThis frees the space they use, often several GB. Choose No to keep them for a later reinstall.$\r$\n$\r$\nYour rendered reels in Videos\Siftora are not deleted." \
      /SD IDNO IDNO siftoraKeepData
    ; Electron keeps app data per user, even for an all-users install.
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}
    ; APP_PRODUCT_FILENAME is only defined for one-click installers.
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
    siftoraKeepData:
  ${endIf}
!macroend
