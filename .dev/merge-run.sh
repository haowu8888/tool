# Runs the 合并文档 export of a kind (pdf, pptx, image) through the save
# dialog: the page starts it, the desktop test fills the dialog in.
kind=$1; ext=$2
sed "s/KIND/$kind/g" .dev/js/merge-ui.js > .dev/js/tmp-merge.js
printf '%s' "-test.run TestDeskSaveDialog -test.v -test.count=1 -save D:\\AI\\claude-docker\\workspace\\tool\\.dev\\doc-out\\merge.$ext" > .dev/desktest.txt
host-exec 'Set-Location -LiteralPath "D:\AI\claude-docker\workspace\tool"; New-Item -ItemType Directory -Force .dev\doc-out | Out-Null; Remove-Item .dev\doc-out\merge.'$ext' -ErrorAction SilentlyContinue; node .dev\cdp.mjs "@.dev/js/tmp-merge.js"; powershell -NoProfile -File .dev\run-task.ps1 ToolboxTest desktest.log | Out-Null; Get-Content .dev\desktest.log; Start-Sleep 3; node .dev\cdp.mjs "@.dev/js/tmp-q.js"; Get-ChildItem .dev\doc-out\merge.* | Select-Object Name,Length | Format-Table -HideTableHeaders' 2>&1 | grep -v CLIXML | grep -v "^<Objs" | grep -v "^$"
