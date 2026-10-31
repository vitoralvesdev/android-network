import { AGENT_ONLINE_MS } from "./agents/registry.js";
import { VERSION } from "./core/settings.js";

export type Capability = {
  id: string;
  title: string;
  description: string;
  entry?: string;
  commands?: string[];
  endpoints?: string[];
};

export type CapabilityArea = {
  id: "agents" | "discovery" | "adb" | "system";
  title: string;
  summary: string;
  primary?: boolean;
  capabilities: Capability[];
};

export function getCapabilities() {
  const areas: CapabilityArea[] = [
    {
      id: "agents",
      title: "Agentes (principal)",
      summary:
        "A box abre a página /agent, conecta de dentro para fora e passa a aparecer no painel. Não exige ADB, root ou portas abertas na box.",
      primary: true,
      capabilities: [
        {
          id: "connect-agent",
          title: "Conectar uma box pela rede",
          description:
            "Abra a URL do agente no navegador da box, informe o token e mantenha a página aberta. O vínculo é box → PC.",
          entry: "/agent",
          endpoints: ["POST /api/agent/register", "POST /api/agent/heartbeat"],
        },
        {
          id: "list-agents",
          title: "Ver conexões ativas",
          description: `Lista todas as boxes conectadas, com status online/offline (janela de ${Math.round(
            AGENT_ONLINE_MS / 1000,
          )}s), IP, modelo, Android, tela, idioma e último resultado.`,
          entry: "/",
          endpoints: ["GET /api/agents"],
        },
        {
          id: "agent-info",
          title: "Pedir identificação do aparelho",
          description: "Enfileira o comando info; a box responde no próximo heartbeat com modelo, Android, tela, idioma e User-Agent.",
          commands: ["info"],
          endpoints: ["POST /api/agents/:id/command", "POST /api/agent/result"],
        },
        {
          id: "agent-env",
          title: "Ler ambiente do navegador",
          description:
            "Pede platform, UA-CH, núcleos, memória, WebGL e rede para diagnosticar se a box é Android de verdade.",
          commands: ["env"],
          endpoints: ["POST /api/agents/:id/command"],
        },
        {
          id: "agent-open-url",
          title: "Abrir um site na box",
          description: "Abre uma URL http(s) no navegador da box, útil para testes e atalhos.",
          commands: ["open https://exemplo.com"],
          endpoints: ["POST /api/agents/:id/command"],
        },
        {
          id: "agent-remove",
          title: "Remover uma box da lista",
          description: "Remove o registro do agente. Se a página continuar aberta, ele volta a se registrar no próximo heartbeat.",
          endpoints: ["DELETE /api/agents/:id"],
        },
        {
          id: "agent-token",
          title: "Autenticar agentes por token",
          description:
            "O token fica em agent-token.txt e autentica apenas os endpoints de agente. O restante da API continua restrito ao localhost.",
          commands: ["x-agent-token: <token>"],
        },
      ],
    },
    {
      id: "discovery",
      title: "Descoberta na rede",
      summary:
        "Ferramentas auxiliares para localizar e identificar aparelhos. Não são necessárias para o modo agente.",
      capabilities: [
        {
          id: "scan",
          title: "Varrer a rede local",
          description:
            "Combina hosts conhecidos, adb devices, mDNS, SSDP/UPnP, cache ARP e varredura TCP da sub-rede principal.",
          entry: "/discovery",
          endpoints: ["POST /api/scan/start", "GET /api/scan/status", "GET /api/devices"],
        },
        {
          id: "identify",
          title: "Identificar tipo e modelo",
          description:
            "Classifica Android TV/Cast, Apple, roteador ou desconhecido e enriquece com AirPlay /info, Google Cast e descrição UPnP.",
        },
        {
          id: "wake",
          title: "Acordar aparelho (Wake-on-LAN)",
          description: "Envia magic packet para hosts conhecidos quando o keep-alive encontra um IP offline (configurável).",
        },
        {
          id: "host-cache",
          title: "Gerenciar hosts conhecidos",
          description: "Consulta e limpa o cache de IPs, portas e nomes já vistos.",
          endpoints: ["GET /api/hosts", "DELETE /api/hosts"],
        },
      ],
    },
    {
      id: "adb",
      title: "ADB (opcional)",
      summary:
        "Só funciona se a box expuser ADB e autorizar a conexão. Não é necessário para listar agentes.",
      capabilities: [
        {
          id: "adb-list",
          title: "Coletar dados por ADB",
          description: "Identifica o aparelho e coleta fabricante, modelo, Android, RAM, armazenamento, uptime e bateria.",
          commands: ["list <ip-ou-nome>"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-pair",
          title: "Parear depuração sem fio (Android 11+)",
          description: "Pareia usando o código exibido na TV e depois conecta na porta de conexão.",
          commands: ["pair <ip:porta> <código>", "connect <ip:porta>"],
        },
        {
          id: "adb-connect",
          title: "Conectar e desconectar",
          description: "Gerencia sessões ADB por IP, nome ou porta.",
          commands: ["connect <ip[:porta]>", "disconnect <ip[:porta]>"],
        },
        {
          id: "adb-apps",
          title: "Listar aplicativos",
          description: "Lista pacotes de usuário e de sistema instalados na box.",
          commands: ["apps <alvo>"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-install",
          title: "Instalar ou atualizar APK",
          description:
            "Instala um APK do PC via ADB ou pelo envio direto do arquivo no painel (Instalar APK).",
          commands: ["install <alvo> <caminho.apk>"],
          endpoints: ["POST /api/command", "POST /api/transfer?action=install"],
        },
        {
          id: "adb-uninstall",
          title: "Remover aplicativo",
          description:
            "Remove um app pelo nome do pacote. Exige confirmar; apps de sistema podem falhar ou exigir pm uninstall --user 0.",
          commands: ["uninstall <alvo> <pacote> confirmar"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-screen",
          title: "Capturar a tela",
          description: "Tira um screenshot via ADB e mostra a prévia no painel.",
          commands: ["screen <alvo>"],
          entry: "/discovery",
          endpoints: ["POST /api/command", "GET /api/captures/:file"],
        },
        {
          id: "adb-push",
          title: "Enviar arquivo",
          description: "Copia um arquivo do PC para a box (padrão /sdcard/Download).",
          commands: ["push <alvo> <arquivo> [destino]"],
          endpoints: ["POST /api/command", "POST /api/transfer?action=push"],
        },
        {
          id: "adb-reboot",
          title: "Reiniciar a box",
          description: "Reinicia o aparelho via ADB. Exige confirmar; a sessão cai e volta em alguns segundos.",
          commands: ["reboot <alvo> confirmar"],
          endpoints: ["POST /api/command"],
        },
        {
          id: "adb-keepalive",
          title: "Manter sessão viva",
          description: "Testa periodicamente hosts ADB conhecidos, reconecta e pode acordar a box via Wake-on-LAN.",
        },
        {
          id: "adb-abort",
          title: "Abortar operação",
          description: "Cancela uma coleta em andamento.",
          commands: ["abort", "help"],
        },
      ],
    },
    {
      id: "system",
      title: "Sistema",
      summary: "Observabilidade e ajustes do servidor.",
      capabilities: [
        {
          id: "logs",
          title: "Logs em tempo real",
          description: "Atividade do servidor via Server-Sent Events, exibida no painel.",
          endpoints: ["GET /api/logs"],
        },
        {
          id: "config",
          title: "Configurações de descoberta",
          description: "Ajusta etapas da varredura, tempos, keep-alive e Wake-on-LAN.",
          entry: "/settings.html",
          endpoints: ["GET /api/config", "POST /api/config", "POST /api/config/reset"],
        },
        {
          id: "capabilities",
          title: "Mapa de capacidades",
          description: "Esta lista, também disponível em JSON.",
          entry: "/",
          endpoints: ["GET /api/capabilities"],
        },
      ],
    },
  ];

  return { version: VERSION, agentOnlineMs: AGENT_ONLINE_MS, areas };
}
