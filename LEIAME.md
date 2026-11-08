# Sorteios CEAF – publicação pelo GitHub e Google

Sistema de sorteio de vagas em cursos e eventos externos de curta duração custeados pelo CEAF, com reserva opcional de 50% das vagas à participação feminina (Despacho da PGJ no PA SGA n. 2025/031558).

Esta versão funciona sem servidor próprio:

| Parte | Onde fica | Papel |
|---|---|---|
| Páginas | GitHub Pages (este repositório) | Registro público, atas, formulário de inscrição e área da equipe |
| Servidor | Google Apps Script (`apps-script/Codigo.gs`) | Sorteia, recebe inscrições, controla o login e faz o sorteio automático |
| Dados | Planilha Google ligada ao Apps Script | Sorteios, inscrições, controle, histórico e usuários |
| Cópia permanente | Pasta `registros/` deste repositório | Cada sorteio é gravado aqui pelo servidor. O histórico do GitHub é público e datado. |

O passo a passo leva cerca de 30 minutos. Use **contas do CEAF**, e não contas pessoais, para que o sistema não dependa de uma pessoa: um Gmail do setor e um usuário do GitHub do setor.

---

## Parte 1 – Planilha e servidor (Google)

1. **Crie a planilha.** Entre no Google Drive com a conta do CEAF e crie uma planilha em branco chamada `Sorteios CEAF – dados`.
2. **Abra o Apps Script.** Na planilha, clique em **Extensões → Apps Script**.
3. **Cole o código.** No arquivo `Código.gs` que aparece, apague todo o conteúdo e cole o conteúdo de [`apps-script/Codigo.gs`](apps-script/Codigo.gs). Clique em **Salvar** (ícone de disquete). Se quiser, renomeie o projeto para `Sorteios CEAF`.
4. **Ajuste o fuso horário.** Clique em **Configurações do projeto** (engrenagem, à esquerda) e escolha o fuso **(GMT-03:00) Horário de Brasília – São Paulo**.
5. **Execute a configuração.** Volte ao **Editor** (`< >`). No alto, escolha a função **`configurar`** e clique em **Executar**.
   - O Google pede autorização. Escolha a conta do CEAF.
   - Se aparecer "O Google não verificou este app", clique em **Avançado → Acessar Sorteios CEAF (não seguro)** e depois em **Permitir**. O aviso aparece porque o script é seu, e não de uma empresa verificada pelo Google.
   - Ao final, o registro de execução mostra: *Administrador criado: usuário admin, senha admin2026*. O ano muda conforme o ano corrente.
   - A configuração cria as abas da planilha e agenda a tarefa que, a cada 5 minutos, faz os sorteios automáticos e as cópias no GitHub.
6. **Publique o servidor.** Clique em **Implantar → Nova implantação**.
   - Em "Selecionar tipo" (engrenagem), escolha **App da Web**.
   - **Executar como:** *Eu*.
   - **Quem pode acessar:** *Qualquer pessoa*. O controle de acesso é feito pelo próprio sistema, com usuário e senha.
   - Clique em **Implantar** e **copie o endereço do app da Web**. Ele termina em `/exec`.

## Parte 2 – Páginas (GitHub)

7. **Crie o repositório.** Entre no GitHub com o usuário do CEAF e clique em **New repository**.
   - Nome: `sorteios-ceaf`.
   - Visibilidade: **Public**. O registro dos sorteios precisa ser público.
   - Clique em **Create repository**.
8. **Envie os arquivos.** Na página do repositório, clique em **uploading an existing file**. Arraste **todo o conteúdo desta pasta**: `index.html`, `app.js`, `estilo.css`, `config.js`, `verificar_sorteio.py`, `.nojekyll` e as pastas `fontes`, `vendor`, `apps-script`, `testes` e `registros`. Clique em **Commit changes**.
9. **Informe o endereço do servidor.** Abra o arquivo `config.js` no GitHub e clique no lápis (Edit). Troque `COLE_AQUI_O_ENDERECO_DO_APPS_SCRIPT` pelo endereço copiado no passo 6, mantendo as aspas. Clique em **Commit changes**.
10. **Ligue o GitHub Pages.** Vá em **Settings → Pages**.
    - Em "Build and deployment", escolha **Deploy from a branch**, ramo **main**, pasta **/ (root)**, e clique em **Save**.
    - Em um ou dois minutos, o site fica disponível em `https://<usuario>.github.io/sorteios-ceaf/`.

## Parte 3 – Cópia permanente dos sorteios no GitHub

Com esta parte, cada sorteio realizado é gravado automaticamente em `registros/<código>.json` no repositório. A ata pública confere o sorteio com essa cópia, e o histórico de alterações do GitHub mostra quando ela foi gravada.

11. **Crie um token de acesso.** No GitHub, clique na foto do perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
    - **Nome:** `Sorteios CEAF`.
    - **Validade:** a mais longa permitida. Anote a data e renove o token antes de vencer.
    - **Repository access:** *Only select repositories* → `sorteios-ceaf`.
    - **Permissions → Repository permissions → Contents:** *Read and write*.
    - Clique em **Generate token** e copie o token. Ele aparece uma única vez.
12. **Guarde o token no Apps Script.** No Apps Script, vá em **Configurações do projeto → Propriedades do script → Adicionar propriedade do script** e crie:

    | Propriedade | Valor |
    |---|---|
    | `GITHUB_TOKEN` | o token copiado no passo 11 |
    | `GITHUB_REPOSITORIO` | `<usuario>/sorteios-ceaf` (ex.: `ceaf-mpsc/sorteios-ceaf`) |

    Clique em **Salvar propriedades do script**. O token fica só no Apps Script e não aparece nas páginas.

## Parte 4 – Primeiro acesso

13. Abra o site, clique em **Acesso da equipe** e entre com o usuário `admin` e a senha `admin` + ano (ex.: `admin2026`). **Troque a senha imediatamente**: como o padrão é conhecido, faça isso logo depois de publicar, antes de divulgar o endereço.
14. Na aba **Usuários**, crie os usuários da equipe. A senha provisória de cada um é o usuário seguido do ano (ex.: `maria.souza2026`), e a troca é obrigatória no primeiro acesso.
15. Faça um sorteio de teste e confira a ata. Em alguns minutos, deve aparecer *"Idêntico à cópia permanente publicada no GitHub"*.

---

## Uso no dia a dia

- **Sorteio automático:** é feito pela tarefa agendada, **em até 5 minutos depois do horário marcado**.
- **Excel:** a planilha é gerada no navegador, pelo botão "Exportar para Excel" no Controle.
- **QR codes:** são gerados no navegador e baixados em PNG.
- **E-mails aceitos no formulário:** só `@mpsc.mp.br`. Para mudar, edite a propriedade `DOMINIOS_EMAIL` no Apps Script (domínios separados por vírgula).

## Atualizar o servidor

Depois de alterar o `Codigo.gs` no Apps Script, vá em **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão → Implantar**. Assim o endereço continua o mesmo e o `config.js` não precisa mudar.

## Cuidados

- **Planilha:** compartilhe só com quem administra o sistema. As abas avisam quem tenta editar à mão. Uma alteração manual num sorteio é detectada pela verificação pública, e a cópia no GitHub mostra o conteúdo original.
- **Cópia de segurança:** periodicamente, use **Arquivo → Fazer uma cópia** na planilha.
- **Token do GitHub:** se vencer, os sorteios continuam funcionando, mas a cópia no GitHub fica pendente. Gere um novo token e atualize `GITHUB_TOKEN`; as cópias pendentes são publicadas na rodada seguinte.
- **Limites do Google:** a conta gratuita aguenta com folga o volume do CEAF. Sessões duram até 6 horas; depois disso, basta entrar de novo.
- **Senha do administrador perdida:** no Apps Script, abra a aba `usuarios` da planilha, apague a linha do `admin` e execute de novo a função `configurar`. O usuário `admin` é recriado com a senha padrão (admin + ano), e a troca volta a ser obrigatória.

## Verificação independente

Qualquer pessoa pode refazer um sorteio fora do sistema com o [verificador em Python](verificar_sorteio.py), que usa só a biblioteca padrão:

```bash
python3 verificar_sorteio.py s2026-001.json
```

## Testes (para quem mantém o código)

A pasta `testes/` tem um simulador dos serviços do Google que roda o `Codigo.gs` no navegador. Para usar, sirva a pasta por um servidor local (ex.: `python -m http.server`) e abra:

- `testes/testes-servidor.html`: testes automáticos do servidor (63 verificações);
- `testes/teste-local.html`: o sistema completo com dados de teste guardados só no navegador.

## Licenças de terceiros

- Fonte Montserrat: SIL Open Font License 1.1 (`fontes/OFL.txt`).
- `vendor/qrcode.js`: QR Code Generator, de Kazuhiko Arase, licença MIT.
- `vendor/xlsx.mini.min.js`: SheetJS Community Edition, licença Apache 2.0.
