param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")),
  [string]$OutputDir = "",
  [switch]$IncludeEnv
)

$ErrorActionPreference = "Stop"

$resolvedProjectRoot = (Resolve-Path $ProjectRoot).Path
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
  $OutputDir = Join-Path $resolvedProjectRoot "migration-packages"
}

if (!(Test-Path $OutputDir)) {
  New-Item -Path $OutputDir -ItemType Directory | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stagingDir = Join-Path $OutputDir ("milionario-migration-" + $timestamp)
$packageName = "milionario-migration-" + $timestamp + ".zip"
$zipPath = Join-Path $OutputDir $packageName

New-Item -Path $stagingDir -ItemType Directory | Out-Null

$foldersToCopy = @("backend", "frontend", "gemini")
foreach ($folder in $foldersToCopy) {
  $source = Join-Path $resolvedProjectRoot $folder
  if (!(Test-Path $source)) {
    throw "Pasta obrigatória não encontrada: $source"
  }

  Copy-Item -Path $source -Destination (Join-Path $stagingDir $folder) -Recurse -Force
}

$backendNodeModules = Join-Path $stagingDir "backend\node_modules"
if (Test-Path $backendNodeModules) {
  Remove-Item -Path $backendNodeModules -Recurse -Force
}

$backendDataDir = Join-Path $stagingDir "backend\data"
if (!(Test-Path $backendDataDir)) {
  New-Item -Path $backendDataDir -ItemType Directory | Out-Null
}

$dbPath = Join-Path $backendDataDir "milionario.sqlite"
if (!(Test-Path $dbPath)) {
  throw "Banco de dados não encontrado em: $dbPath"
}

$readmeSource = Join-Path $resolvedProjectRoot "README.md"
if (Test-Path $readmeSource) {
  Copy-Item -Path $readmeSource -Destination (Join-Path $stagingDir "README.md") -Force
}

$envExampleSource = Join-Path $resolvedProjectRoot "backend\.env.example"
if (Test-Path $envExampleSource) {
  Copy-Item -Path $envExampleSource -Destination (Join-Path $stagingDir "backend\.env.example") -Force
}

if ($IncludeEnv) {
  $envFile = Join-Path $resolvedProjectRoot "backend\.env"
  if (Test-Path $envFile) {
    Copy-Item -Path $envFile -Destination (Join-Path $stagingDir "backend\.env") -Force
  }
}

$manifestPath = Join-Path $stagingDir "MIGRATION_MANIFEST.txt"
$manifest = @(
  "Milionario Host Migration Package",
  "GeneratedAt: " + (Get-Date -Format "o"),
  "ProjectRoot: " + $resolvedProjectRoot,
  "Package: " + $packageName,
  "IncludeEnv: " + [string]$IncludeEnv,
  "",
  "Included:",
  "- backend/ (sem node_modules)",
  "- frontend/",
  "- gemini/",
  "- backend/data/milionario.sqlite",
  "- backend/.env.example (se existir)",
  "- backend/.env (apenas se -IncludeEnv)",
  "- README.md"
)
Set-Content -Path $manifestPath -Value $manifest -Encoding UTF8

if (Test-Path $zipPath) {
  Remove-Item -Path $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagingDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Remove-Item -Path $stagingDir -Recurse -Force

Write-Output "MIGRATION_PACKAGE=$zipPath"
Write-Output "NEXT_STEP=Copie este ZIP para o novo host e execute o script import-host-migration.ps1"