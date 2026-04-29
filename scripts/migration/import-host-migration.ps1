param(
  [Parameter(Mandatory = $true)]
  [string]$PackagePath,
  [string]$TargetRoot = "",
  [switch]$InstallDependencies
)

$ErrorActionPreference = "Stop"

$resolvedPackagePath = (Resolve-Path $PackagePath).Path
if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
  $TargetRoot = (Get-Location).Path
}

if (!(Test-Path $TargetRoot)) {
  New-Item -Path $TargetRoot -ItemType Directory | Out-Null
}

$targetName = [System.IO.Path]::GetFileNameWithoutExtension($resolvedPackagePath)
$deployDir = Join-Path $TargetRoot $targetName

if (Test-Path $deployDir) {
  throw "Diretório de destino já existe: $deployDir"
}

New-Item -Path $deployDir -ItemType Directory | Out-Null
Expand-Archive -Path $resolvedPackagePath -DestinationPath $deployDir -Force

$requiredPaths = @(
  "backend",
  "frontend",
  "gemini",
  "backend\data\milionario.sqlite",
  "backend\package.json"
)

foreach ($rel in $requiredPaths) {
  $abs = Join-Path $deployDir $rel
  if (!(Test-Path $abs)) {
    throw "Pacote inválido. Arquivo/pasta obrigatória ausente: $rel"
  }
}

if ($InstallDependencies) {
  Push-Location (Join-Path $deployDir "backend")
  try {
    if (Test-Path "package-lock.json") {
      npm ci
    } else {
      npm install
    }
  }
  finally {
    Pop-Location
  }
}

Write-Output "DEPLOY_DIR=$deployDir"
Write-Output "DB_PATH=" + (Join-Path $deployDir "backend\data\milionario.sqlite")
Write-Output "NEXT_STEP_1=Entre em $deployDir\\backend"
Write-Output "NEXT_STEP_2=Configure backend\\.env (ou use .env.example)"
Write-Output "NEXT_STEP_3=Execute: npm start"