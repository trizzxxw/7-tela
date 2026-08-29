# Lunara Live 🌙

Site de transmissão de tela em tempo real com WebRTC.

## Recursos
- Transmissão de tela pelo navegador
- Salas com código
- Senha opcional
- Chat ao vivo
- Contador de espectadores
- Link de convite
- Tela cheia
- Layout responsivo

## Publicar no Render

### 1. Envie estes arquivos para um repositório no GitHub
O arquivo `render.yaml` já está configurado.

### 2. No Render
Crie um novo **Blueprint** e selecione o repositório do Lunara Live.

O Render deve reconhecer automaticamente o `render.yaml`.

### 3. Publicação
Após o deploy, o Render fornecerá um endereço HTTPS para o site.

## Testar localmente

```bash
npm install
npm start
```

Depois abra `http://localhost:3000`.

## Produção
O HTTPS fornecido pela hospedagem permite o uso da API de compartilhamento de tela em navegadores compatíveis.

Para conexões WebRTC mais confiáveis em redes restritivas, um servidor TURN pode ser adicionado posteriormente.
