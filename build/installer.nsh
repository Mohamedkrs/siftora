; Siftora installer additions (electron-builder includes this file, see electron-builder.yml).

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
    RMDir /r "$APPDATA\${APP_PRODUCT_FILENAME}"
    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
    siftoraKeepData:
  ${endIf}
!macroend
