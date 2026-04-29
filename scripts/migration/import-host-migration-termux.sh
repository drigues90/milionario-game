#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

usage() {
  cat <<'EOF'
Uso:
  ./import-host-migration-termux.sh -p <arquivo.zip> [-t <pasta_destino>] [-i]

Parâmetros:
  -p  Caminho para o pacote ZIP de migração (obrigatório)
  -t  Pasta raiz de destino (opcional; padrão: diretório atual)
  -i  Instala dependências do backend após extração (npm ci / npm install)
  -h  Exibe ajuda

Exemplo:
  ./import-host-migration-termux.sh -p ~/storage/downloads/milionario-migration-20260429-111445.zip -t ~/apps -i
EOF
}

PACKAGE_PATH=""
TARGET_ROOT="$(pwd)"
INSTALL_DEPS="false"

while getopts ":p:t:ih" opt; do
  case "$opt" in
    p) PACKAGE_PATH="$OPTARG" ;;
    t) TARGET_ROOT="$OPTARG" ;;
    i) INSTALL_DEPS="true" ;;
    h)
      usage
      exit 0
      ;;
    \?)
      echo "Parâmetro inválido: -$OPTARG" >&2
      usage
      exit 1
      ;;
    :)
      echo "Parâmetro -$OPTARG requer um valor." >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$PACKAGE_PATH" ]]; then
  echo "Erro: informe o pacote com -p." >&2
  usage
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "Erro: 'unzip' não encontrado. No Termux execute: pkg install unzip" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Erro: 'npm' não encontrado. No Termux execute: pkg install nodejs" >&2
  exit 1
fi

if [[ ! -f "$PACKAGE_PATH" ]]; then
  echo "Erro: pacote não encontrado: $PACKAGE_PATH" >&2
  exit 1
fi

mkdir -p "$TARGET_ROOT"

PACKAGE_BASENAME="$(basename "$PACKAGE_PATH")"
TARGET_NAME="${PACKAGE_BASENAME%.zip}"
DEPLOY_DIR="$TARGET_ROOT/$TARGET_NAME"

if [[ -e "$DEPLOY_DIR" ]]; then
  echo "Erro: diretório de destino já existe: $DEPLOY_DIR" >&2
  exit 1
fi

mkdir -p "$DEPLOY_DIR"
unzip -q "$PACKAGE_PATH" -d "$DEPLOY_DIR"

required_paths=(
  "backend"
  "frontend"
  "gemini"
  "backend/data/milionario.sqlite"
  "backend/package.json"
)

for rel in "${required_paths[@]}"; do
  if [[ ! -e "$DEPLOY_DIR/$rel" ]]; then
    echo "Erro: pacote inválido. Ausente: $rel" >&2
    exit 1
  fi
done

if [[ "$INSTALL_DEPS" == "true" ]]; then
  pushd "$DEPLOY_DIR/backend" >/dev/null
  if [[ -f "package-lock.json" ]]; then
    npm ci
  else
    npm install
  fi
  popd >/dev/null
fi

echo "DEPLOY_DIR=$DEPLOY_DIR"
echo "DB_PATH=$DEPLOY_DIR/backend/data/milionario.sqlite"
echo "NEXT_STEP_1=cd \"$DEPLOY_DIR/backend\""
echo "NEXT_STEP_2=Configure backend/.env (ou use .env.example)"
echo "NEXT_STEP_3=npm start"