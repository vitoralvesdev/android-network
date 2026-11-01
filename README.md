# Android Network

<p align="center">
  **Gerenciamento e manutenção de dispositivos Android TV pela rede local.**
</p>

O **Android Network** é uma ferramenta desenvolvida em Node.js e TypeScript para localizar, conectar e realizar operações de manutenção em Android TVs e TV Boxes pela rede.

O projeto já oferece integração com **Android Debug Bridge (ADB)** para tarefas como listar aplicativos, instalar e remover APKs, capturar a tela, transferir arquivos e reiniciar dispositivos.

A proposta é evoluir para uma plataforma de manutenção mais completa: além do ADB, o projeto está recebendo novos modos de conexão e gerenciamento, incluindo um **Agent Mode com recursos inteligentes e futura integração com IA**, para permitir interações mais naturais com o aparelho.

> **Status do projeto:** em desenvolvimento ativo. O modo ADB já possui funcionalidades operacionais. Os recursos relacionados aos agentes — incluindo o Agent Mode inteligente e a experiência de interação com IA — são experimentais e ainda estão em desenvolvimento.

---

## Índice

- [Visão geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Requisitos](#requisitos)
- [Instalação](#instalação)
- [Executando o projeto](#executando-o-projeto)
- [Conectando um dispositivo com ADB](#conectando-um-dispositivo-com-adb)
- [Comandos disponíveis no ADB](#comandos-disponíveis-no-adb)
- [Agent Mode — em desenvolvimento](#agent-mode--em-desenvolvimento)
- [Descoberta de dispositivos](#descoberta-de-dispositivos)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Rede e segurança](#rede-e-segurança)
- [Limitações conhecidas](#limitações-conhecidas)
- [Tecnologias](#tecnologias)
- [Contribuindo](#contribuindo)

---

## Visão geral

A ideia do Android Network é centralizar operações de manutenção de dispositivos Android TV em um painel acessível pelo computador, sem precisar executar manualmente cada tarefa no terminal.

O projeto está sendo construído em módulos, para que diferentes formas de comunicação com o dispositivo possam coexistir.

| Módulo             | Objetivo                                                       | Situação                                    |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| ADB                | Executar operações de manutenção nos dispositivos              | Funcional                                   |
| Descoberta de rede | Localizar e identificar dispositivos na LAN                    | Implementado, sujeito às limitações da rede |
| Agent Mode         | Criar uma comunicação alternativa com o dispositivo            | Experimental / em desenvolvimento           |
| Agent com IA       | Permitir interação inteligente e comandos em linguagem natural | Planejado / em desenvolvimento              |

O ADB continua sendo uma parte importante do projeto, mas não é o destino final da ferramenta.

## Funcionalidades

### ADB — disponível

O módulo ADB permite executar operações diretamente em dispositivos Android autorizados:

- Identificar o dispositivo e consultar informações do sistema.
- Listar aplicativos instalados, incluindo aplicativos de sistema.
- Instalar e atualizar arquivos APK.
- Desinstalar aplicativos.
- Capturar a tela do dispositivo.
- Transferir arquivos do computador para a TV Box.
- Reiniciar o dispositivo.
- Conectar, desconectar e parear dispositivos pela rede.
- Manter conexões ADB conhecidas e tentar reconectá-las.

### Descoberta de dispositivos — implementada

O sistema reúne diferentes fontes de informação para localizar dispositivos na rede local:

- Dispositivos ADB conhecidos.
- Descoberta mDNS.
- SSDP / UPnP.
- Serviços relacionados a Cast, Android TV Remote e AirPlay.
- Cache ARP e varredura TCP da sub-rede.
- Identificação por nome, fabricante, modelo e evidências de rede.
- Classificação de dispositivos Android TV, Android, Apple, roteadores e desconhecidos.
- Identificação de dispositivos conectados por USB, quando disponíveis pelo ADB.
- Wake-on-LAN para dispositivos conhecidos.

A descoberta depende dos serviços que cada aparelho disponibiliza na rede. Portanto, nem todo dispositivo será identificado automaticamente.

### Agent Mode — em desenvolvimento

O projeto possui uma estrutura experimental de agentes para explorar formas alternativas de comunicação e gerenciamento dos dispositivos.

A direção desse módulo é permitir que o computador se comunique com a TV por meio de um agente executado no próprio aparelho, reduzindo a dependência de uma conexão ADB tradicional.

Entre as experiências e funcionalidades presentes nessa estrutura estão:

- Registro e acompanhamento de agentes conectados.
- Envio de comandos e recebimento de resultados.
- Coleta de informações do dispositivo e do ambiente.
- Comunicação por heartbeat para acompanhar o estado da conexão.
- Agente executado no navegador da TV.
- Protótipo de agente nativo Android (APK).
- Ferramenta de linha de comando para comunicação com o agente nativo.

**Importante:** essa estrutura ainda está em desenvolvimento. As capacidades, compatibilidade e estabilidade podem variar entre dispositivos e versões de Android. Não considere o Agent Mode uma substituição completa do ADB neste momento.

#### Visão futura: agente inteligente com IA

A proposta de evolução é permitir que o usuário converse com o dispositivo de maneira mais natural.

Em vez de depender exclusivamente de comandos técnicos, a intenção é desenvolver um agente capaz de interpretar solicitações, entender o contexto do aparelho e executar operações compatíveis com as permissões disponíveis.

Essa experiência ainda está em desenvolvimento. Não é apresentada como uma funcionalidade pronta ou garantida nesta versão.

---

## Requisitos

Antes de começar, tenha instalado:

- **Node.js 20 ou superior**
- **npm**, normalmente instalado junto com o Node.js
- **Git**, caso vá clonar o repositório

Para utilizar o módulo ADB:

- Android SDK Platform Tools.
- Executável `adb` disponível no `PATH` do sistema.
- Depuração ADB habilitada e autorização concedida no dispositivo.

Para testar recursos de agentes:

- Computador e TV Box acessíveis pela mesma rede local.
- Navegador compatível na TV, para o agente web.
- Para o protótipo nativo, instalação do APK e permissões necessárias no Android.

---

## Instalação

### 1. Clone o repositório

```bash
git clone https://github.com/vitoralvesdev/android-network.git
```

### 2. Entre na pasta

```bash
cd android-network
```

### 3. Instale as dependências

```bash
npm install
```

### 4. Inicie o servidor em desenvolvimento

```bash
npm run dev
```

O painel será disponibilizado localmente na porta `3000`.

---

## Executando o projeto

Depois de iniciar o servidor, acesse pelo navegador:

| Página           | Endereço                              | Descrição                               |
| ---------------- | ------------------------------------- | --------------------------------------- |
| Painel principal | `http://localhost:3000`               | Painel inicial e visão das capacidades  |
| Descoberta       | `http://localhost:3000/discovery`     | Dispositivos encontrados e terminal ADB |
| Agente web       | `http://localhost:3000/agent`         | Página experimental executada na TV     |
| Comandos         | `http://localhost:3000/commands.html` | Referência de comandos e capacidades    |
| Configurações    | `http://localhost:3000/settings.html` | Configurações e dispositivos em cache   |

### Acesso pela rede local

Por padrão, o servidor escuta em `0.0.0.0:3000`, permitindo conexões de outros dispositivos da rede.

Para abrir uma página na TV Box, substitua o endereço abaixo pelo IP local do computador:

```text
http://IP-DO-COMPUTADOR:3000
```

Exemplo:

```text
http://192.168.1.10:3000
```

Na primeira execução, o Windows pode solicitar autorização para o Node.js no Firewall. Permita o acesso em redes privadas para que os dispositivos da LAN consigam alcançar o servidor.

Para executar somente no próprio computador:

```bash
HOST=127.0.0.1 npm run dev
```

No PowerShell do Windows:

```powershell
$env:HOST="127.0.0.1"; npm run dev
```

---

## Conectando um dispositivo com ADB

O ADB é a forma de conexão mais consolidada do projeto.

Existem duas possibilidades principais: conexão USB ou conexão pela rede Wi-Fi/Ethernet.

### Opção 1 — USB

1. Ative as opções do desenvolvedor na TV Box.
2. Habilite a depuração USB.
3. Conecte o aparelho ao computador por USB.
4. Aceite a autorização de depuração exibida na TV.
5. No terminal, execute:

```bash
adb devices
```

O serial do aparelho aparecerá na lista. Esse serial pode ser utilizado como alvo dos comandos do projeto.

### Opção 2 — ADB pela rede

**Android 11 ou superior:**

1. Ative as opções do desenvolvedor.
2. Habilite a opção **Depuração sem fio**.
3. Consulte o endereço e a porta de pareamento exibidos pelo Android.
4. Execute o pareamento:

```text
pair <ip:porta-de-pareamento> <código>
```

5. Depois, conecte usando o endereço e a porta de conexão:

```text
connect <ip:porta-de-conexão>
```

**Android 10 ou inferior:**

1. Habilite a depuração ADB pela rede, quando disponível na firmware.
2. Execute:

```bash
adb connect 192.168.1.20:5555
```

3. Aceite a autorização de depuração exibida na TV, se solicitada.

A disponibilidade dessas opções depende da versão do Android e da firmware instalada pelo fabricante.

---

## Comandos disponíveis no ADB

Os comandos podem ser executados pelo terminal da interface `/discovery` ou pelo terminal do sistema, conforme indicado.

| Comando                               | Descrição                           |
| ------------------------------------- | ----------------------------------- |
| `list <ip-ou-serial>`                 | Consulta informações do dispositivo |
| `apps <alvo>`                         | Lista aplicativos instalados        |
| `install <alvo> <apk>`                | Instala ou atualiza um APK          |
| `uninstall <alvo> <pacote> confirmar` | Desinstala um aplicativo            |
| `screen <alvo>`                       | Captura a tela da TV                |
| `push <alvo> <arquivo> [destino]`     | Envia um arquivo para o dispositivo |
| `reboot <alvo> confirmar`             | Reinicia o dispositivo              |
| `pair <ip:porta> <código>`            | Pareia a depuração sem fio          |
| `connect <ip[:porta]>`                | Conecta um dispositivo pela rede    |
| `disconnect <ip[:porta]>`             | Encerra uma conexão                 |
| `abort`                               | Interrompe uma operação compatível  |
| `help`                                | Exibe a ajuda de comandos           |

Exemplo:

```bash
list 192.168.1.20
```

Listar aplicativos:

```bash
apps 192.168.1.20
```

Instalar um APK:

```bash
install 192.168.1.20 ./meu-aplicativo.apk
```

Desinstalar um aplicativo:

```bash
uninstall 192.168.1.20 com.exemplo.aplicativo confirmar
```

O alvo pode ser um endereço IP, um endereço com porta ou o serial USB exibido pelo `adb devices`.

### Área de aplicativos e arquivos

A interface `/discovery` também disponibiliza uma área para selecionar arquivos pelo navegador e executar operações de instalação, transferência, captura de tela e reinicialização.

As operações que dependem de ADB exigem que o dispositivo esteja conectado e autorizado.

---

## Agent Mode — em desenvolvimento

Esta seção documenta a estrutura experimental existente. Ela não representa uma promessa de compatibilidade ou estabilidade para todos os aparelhos.

### Agente web

O protótipo web é executado no navegador da TV Box.

Para testar:

1. Inicie o servidor no computador.
2. Descubra o IP local do computador.
3. Abra o navegador da TV.
4. Acesse:

```text
http://IP-DO-COMPUTADOR:3000/agent
```

5. Informe o token apresentado pelo painel ou armazenado em `agent-token.txt`.
6. Mantenha a página aberta durante o teste.

A estrutura atual contempla registro, heartbeat, consulta de informações, leitura de dados do ambiente do navegador e abertura de URLs.

**Limitação:** o navegador Android não possui permissões para instalar ou desinstalar aplicativos diretamente. Para essas operações sem ADB, existe um protótipo nativo Android.

### Agente nativo Android (APK)

O projeto também possui um protótipo de agente nativo.

O APK pode ser acessado pelo servidor em:

```text
http://IP-DO-COMPUTADOR:3000/apk
```

ou:

```text
http://IP-DO-COMPUTADOR:3000/tx-agent.apk
```

O aplicativo disponibiliza um servidor HTTP na porta `8790`, com token próprio exibido na interface do agente.

A estrutura atual contempla endpoints para:

| Endpoint              | Operação                                |
| --------------------- | --------------------------------------- |
| `GET /health`         | Verifica se o agente está respondendo   |
| `GET /info`           | Consulta informações do aparelho        |
| `GET /apps`           | Lista aplicativos                       |
| `GET /launch?pkg=`    | Abre um aplicativo                      |
| `GET /open?url=`      | Abre uma URL                            |
| `GET /install?url=`   | Baixa um APK e solicita sua instalação  |
| `GET /uninstall?pkg=` | Solicita a desinstalação                |
| `GET /settings?what=` | Abre uma tela de configurações          |
| `GET /result`         | Consulta o resultado da última operação |

As operações protegidas exigem o token do agente no header `x-agent-token`. O endpoint `/health` é aberto.

A instalação e a desinstalação dependem das permissões e dos recursos da firmware. A instalação solicita confirmação na própria TV.

### CLI do agente nativo

Existe também uma ferramenta de terminal para testar a comunicação com o agente nativo:

```bash
node tools/box.mjs config 192.168.1.20:8790 <token>
```

Consultar informações:

```bash
node tools/box.mjs info
```

Listar aplicativos:

```bash
node tools/box.mjs apps
```

Abrir aplicativo:

```bash
node tools/box.mjs launch com.exemplo.aplicativo
```

Instalar APK:

```bash
node tools/box.mjs install ./meu-aplicativo.apk
```

Desinstalar aplicativo:

```bash
node tools/box.mjs uninstall com.exemplo.aplicativo
```

Também é possível utilizar as variáveis `BOX_HOST`, `BOX_PORT` e `BOX_TOKEN`, ou o atalho:

```bash
npm run box -- <comando>
```

No terminal da página `/discovery`, os comandos do agente podem ser executados com o prefixo `agent` ou `box`, por exemplo:

```text
agent info
agent apps
agent launch com.exemplo.aplicativo
```

---

## Descoberta de dispositivos

A descoberta procura identificar aparelhos disponíveis na rede local usando diferentes protocolos e sinais.

O processo considera:

- Hosts já conhecidos.
- Dispositivos listados pelo ADB.
- Serviços mDNS.
- SSDP / UPnP.
- Serviços Cast, Android TV Remote e AirPlay.
- Cache ARP.
- Varredura TCP da sub-rede principal.
- Informações obtidas por HTTP, DNS reverso e TTL, quando disponíveis.

Os resultados são agrupados e classificados com base nas evidências encontradas.

### Integração com agentes e cache

A API de dispositivos pode combinar informações da descoberta, dos agentes e dos aparelhos ADB conectados por USB.

A interface também pode indicar se existe um agente online ou offline associado ao dispositivo.

Esses recursos fazem parte da estrutura de integração em desenvolvimento.

---

## Estrutura do projeto

A organização é modular: servidor, funcionalidades centrais, agentes, descoberta, ADB e interface web ficam separados.

```text
src/
├── server.ts                 # Inicialização do Express e montagem das rotas
├── capabilities.ts           # Mapa de capacidades da aplicação
│
├── core/
│   ├── settings.ts            # Configurações gerais, porta, host e diretórios
│   ├── log.ts                 # Barramento de logs e eventos SSE
│   ├── routes.ts              # Rotas centrais de API
│   ├── security.ts            # Verificação de requisições locais
│   ├── config-store.ts        # Persistência das configurações
│   ├── host-cache.ts          # Cache de dispositivos conhecidos
│   ├── network.ts             # Interfaces, ARP, DNS, TTL e portas
│   ├── wol.ts                 # Wake-on-LAN
│   └── http.ts / xml.ts /
│       text.ts / time.ts      # Utilitários
│
├── agents/
│   ├── registry.ts            # Registro e estado dos agentes
│   ├── security.ts            # Autenticação dos agentes
│   └── routes.ts              # Endpoints de comunicação dos agentes
│
├── discovery/
│   ├── scan.ts                # Orquestração da descoberta
│   ├── identify.ts            # Identificação e classificação
│   ├── models.ts
│   ├── ports.ts
│   ├── types.ts
│   ├── protocols/             # mDNS, SSDP, AirPlay e Cast
│   └── routes.ts              # Endpoints da descoberta
│
└── adb/
    ├── client.ts              # Cliente ADB e resolução de alvos
    ├── ops.ts                 # Operações de manutenção
    ├── keepalive.ts           # Reconexão e monitoramento
    └── routes.ts              # Comandos, transferências e capturas

public/
├── index.html                 # Painel principal
├── discovery.html             # Descoberta e terminal
├── agent.html                 # Interface do agente web
├── commands.html              # Referência de comandos
├── settings.html              # Configurações
└── js/
    ├── common.js
    ├── capabilities.js
    ├── agents.js
    └── discovery.js

tools/
└── box.mjs                    # CLI do agente nativo
```

A estrutura acima representa os módulos documentados. Arquivos adicionais podem existir no repositório.

---

## Rede e segurança

O servidor utiliza a porta `3000` por padrão e escuta em `0.0.0.0` para permitir comunicação pela rede local.

As regras de acesso atuais são:

- As rotas `/api/*` são restritas a requisições locais, com exceção dos endpoints destinados aos agentes.
- Registro, heartbeat, envio de resultados e envio de comandos aos agentes exigem token válido.
- O token dos agentes é enviado pelo header `x-agent-token` (também há suporte a query ou body nos endpoints previstos).
- A consulta de agentes só disponibiliza o token quando a requisição é local.
- O agente nativo utiliza seu próprio token.
- O endpoint `/health` do agente nativo não exige autenticação.

**Atenção:** não exponha o servidor diretamente à internet. A configuração foi pensada para uso local em uma rede confiável. Tokens e operações de manutenção devem ser tratados como informações sensíveis.

---

## Limitações conhecidas

- Não existe um método universal para identificar toda TV Box apenas pelo endereço IP.
- Dispositivos desligados, em outra sub-rede ou sem serviços de descoberta ativos podem não aparecer.
- A descoberta depende dos protocolos e serviços disponibilizados pela firmware.
- O ADB exige autorização no aparelho antes de permitir operações.
- Algumas fabricantes bloqueiam ou modificam opções de desenvolvedor e depuração.
- A instalação e a remoção de aplicativos pelo agente nativo dependem das permissões disponíveis no Android e na firmware.
- O agente web não tem permissão para instalar ou remover aplicativos diretamente.
- Os recursos relacionados aos agentes ainda são experimentais e podem mudar durante o desenvolvimento.

Se a firmware bloquear as opções de desenvolvedor, pode ser necessário utilizar um menu de engenharia ou ferramentas específicas do fabricante.

---

## Tecnologias

- **Node.js**
- **TypeScript**
- **Express**
- **Android Debug Bridge (ADB)**
- **HTML, CSS e JavaScript**
- **Protocolos de descoberta de rede:** mDNS, SSDP / UPnP e outros

---

## Contribuindo

Contribuições, testes em diferentes modelos de TV Box e relatos de compatibilidade são bem-vindos.

Para contribuir:

1. Faça um fork do repositório.
2. Crie uma branch para sua alteração.
3. Implemente e teste a mudança.
4. Envie um Pull Request explicando o que foi alterado e como testar.

Ao reportar um problema, inclua, sempre que possível:

- Modelo da TV Box.
- Versão do Android e firmware.
- Tipo de conexão (Wi-Fi, Ethernet ou USB).
- Método utilizado (ADB, agente web ou agente nativo).
- Logs e mensagens de erro relevantes.

---

## Licença

Consulte o arquivo `LICENSE` do repositório para informações sobre os termos de uso e distribuição.
