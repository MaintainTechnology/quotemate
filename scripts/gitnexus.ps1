# GitNexus wrapper for the QuoteMax repo.
#
# Why this exists — three host-specific gotchas that silently break `gitnexus`
# when it is invoked bare from a shell on this machine:
#
#   1. NODE VERSION. `C:\Program Files\nodejs` (v24, non-LTS) sits ahead of
#      nvm4w (v22 LTS) on PATH. GitNexus crash-loops every parse worker on v24
#      ("Worker pool failed to start"). We pin Node 22 explicitly.
#
#   2. OPENSSL DLLs. The LadybugDB FTS extension links against OpenSSL 3
#      (libcrypto-3-x64.dll / libssl-3-x64.dll), which ships with Git for
#      Windows but is not on the default PATH. Without it FTS silently
#      disables and `query` returns poorly-ranked results (Windows error 126).
#
#   3. WAL CHECKPOINTING. Rotating WAL checkpoint files fails on this
#      filesystem mid-analyze, leaving orphaned lbug.wal.missing-shadow.*
#      files and a bloated DB. -1 keeps Ladybug's stock behaviour.
#
# Usage:  .\scripts\gitnexus.ps1 <any gitnexus args>
#   e.g.  .\scripts\gitnexus.ps1 status
#         .\scripts\gitnexus.ps1 analyze
#         .\scripts\gitnexus.ps1 impact myFunction --direction upstream

$ErrorActionPreference = 'Stop'

$node = 'C:\nvm4w\nodejs\node.exe'
$cli  = 'C:\Users\dalig\AppData\Roaming\npm\node_modules\gitnexus\dist\cli\index.js'
$gitBin = 'C:\Program Files\Git\mingw64\bin'

if (-not (Test-Path $node)) { throw "Node 22 LTS not found at $node" }
if (-not (Test-Path $cli))  { throw "GitNexus CLI not found at $cli — run: npm install -g gitnexus" }

if (Test-Path $gitBin) { $env:PATH = "$gitBin;$env:PATH" }

$env:GITNEXUS_LBUG_EXTENSION_INSTALL  = 'auto'
$env:GITNEXUS_WAL_CHECKPOINT_THRESHOLD = '-1'

# Low worker count: this box routinely runs with <1GB free RAM (VS Code holds
# several GB), and the default cores-1 pool exhausts memory during startup.
if (-not $env:GITNEXUS_WORKER_POOL_SIZE) { $env:GITNEXUS_WORKER_POOL_SIZE = '2' }
$env:GITNEXUS_WORKER_READY_TIMEOUT_MS = '60000'

& $node $cli @args
exit $LASTEXITCODE
