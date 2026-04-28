# O Milionario

Sistema web para 4 jogadores com:
- **Frontend:** React + Tailwind (via CDN, no browser)
- **Backend:** Node.js + Express
- **Banco:** SQLite (via `sql.js`, persistido em arquivo local)

## Regras implementadas

- Cadastro e login com usuário e senha.
- Limite de **4 jogadores** cadastrados.
- Sorteio automático de **1 Milionário** e **3 Pobres** ao clicar em **Ver seu perfil**.
- Cada jogador deve cadastrar **4 missões** (total de 16 missões no jogo).
- O sistema sorteia **1 missão de cada jogador** para o Milionário (4 missões no total), incluindo uma missão do próprio Milionário.
- Cada jogador pode **editar/remover apenas as próprias missões**.
- Após clicar em **Ver seu perfil**, o jogador não pode mais editar nem remover missões.
- O Milionário só consegue ver as missões sorteadas quando:
  1. o sorteio foi realizado; e
  2. os 4 jogadores cadastraram 4 missões cada.
- Existe um usuário administrativo fixo para controle da rodada:
  - usuário: `admin`
  - senha: `admin`
  - esse perfil vê a tela como perfil pobre e possui um botão de **Resetar rodada**.
- O reset do admin limpa:
  - sorteio de perfis;
  - missões cadastradas;
  - missões sorteadas para o milionário.
- O admin também pode:
  - remover jogadores (isso reinicia o sorteio da rodada);
  - remover missões individualmente.
- No perfil do admin:
  - os nomes dos jogadores ficam ocultos (exibição anônima);
  - o texto das missões dos jogadores fica oculto;
  - é exibida apenas a quantidade de jogadores milionários na rodada.

## Estrutura

- `backend/` API e persistência.
- `frontend/` interface web (React + Tailwind em CDN).
- `backend/data/milionario.sqlite` arquivo de dados persistido localmente.

## Como rodar

### 1) Instalar dependências do backend

```powershell
npm --prefix .\backend install
```

### 2) Iniciar o sistema

```powershell
npm --prefix .\backend start
```

Aplicação disponível em: `http://localhost:3001`

## Desenvolvimento (hot reload)

```powershell
npm --prefix .\backend run dev
```

## Testes

```powershell
npm --prefix .\backend test
```

## Variáveis de ambiente (opcional)

Crie um arquivo `.env` no `backend/` se quiser customizar:

- `PORT` (padrão: `3001`)
- `JWT_SECRET` (padrão de desenvolvimento interno)

## Fluxo de jogo sugerido

1. Quatro jogadores criam conta.
2. Cada jogador clica em **Ver seu perfil** para descobrir se é Milionário ou Pobre.
3. Cada jogador cadastra 4 missões (16 no total).
4. O jogador sorteado como **MILIONARIO** usa o botão de sorteio de missões para visualizar 4 missões (uma de cada jogador, incluindo uma dele).
5. Se necessário, o usuário `admin` pode usar **Resetar rodada** para zerar sorteio e missões.
6. O `admin` pode remover jogadores e missões pelo **Painel do Admin**.

## Observação técnica

O frontend foi implementado em React + Tailwind com CDN para garantir execução no ambiente atual sem etapa de build local, mantendo o requisito de uso dessas tecnologias e acesso via navegador.
