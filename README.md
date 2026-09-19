# Controle de Estoque de Toners — PostgreSQL + Render

Aplicação web para controle compartilhado do estoque de toners da Prefeitura de Grajaú-MA.

## Arquitetura
- Node.js 20+
- Express
- PostgreSQL
- Senhas de técnicos armazenadas com hash bcrypt
- Sessão em cookie HttpOnly
- Estado do estoque armazenado no PostgreSQL em JSONB
- Endpoint `/health` para teste de saúde

## Credenciais iniciais
- Usuário administrador: `admin`
- Senha de login do administrador: `1234`
- Senha de administrador para cadastrar técnico: `1602`

Em produção, altere as duas senhas pelas variáveis `ADMIN_LOGIN_PASSWORD` e `ADMIN_PASSWORD`.

## Rodar localmente
1. Instale Node.js 20+.
2. Crie um PostgreSQL e defina `DATABASE_URL`.
3. Copie `.env.example` para `.env` e ajuste os valores.
4. Execute `npm install`.
5. Execute `npm start`.
6. Acesse `http://localhost:3000`.

O banco é criado automaticamente na primeira inicialização.

## Publicar na Render
1. Suba esta pasta para um repositório GitHub.
2. Na Render, crie um PostgreSQL e copie a `Internal Database URL`.
3. Crie um Web Service ligado ao repositório.
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Configure as variáveis:
   - `DATABASE_URL` = URL do PostgreSQL
   - `ADMIN_PASSWORD` = senha usada para cadastrar técnicos
   - `ADMIN_LOGIN_PASSWORD` = senha de login do admin
   - `NODE_ENV` = `production`
7. Faça o deploy.
8. Teste `https://SEU-ENDERECO/health` e depois abra a página principal.

## Observação sobre o plano gratuito
O código não depende de arquivos locais para guardar o estoque: os dados ficam no PostgreSQL. Isso é importante para que vários computadores/celulares compartilhem os mesmos dados.

A disponibilidade, limites e eventual expiração dos planos gratuitos são definidos pelo provedor e podem mudar. Confira as condições atuais da Render antes de publicar.
