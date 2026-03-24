/**
 * Comprehensive list of AI extensions to detect and display in the AI Checker
 */

export interface AiExtensionInfo {
    id: string;
    name: string;
    description: string;
}

export interface AiProvider {
    color: string;
    extensions: AiExtensionInfo[];
}

export interface AiExtensionsBlocklist {
    [provider: string]: AiProvider;
}

export const AI_EXTENSIONS_BLOCKLIST: AiExtensionsBlocklist = {
    "GitHub": {
        "color": "#181717",
        "extensions": [
            {
                "id": "GitHub.copilot",
                "name": "GitHub Copilot",
                "description": "AI code completion and inline suggestions."
            },
            {
                "id": "GitHub.copilot-chat",
                "name": "GitHub Copilot Chat",
                "description": "Chat-based AI assistant for explanations, edits, and queries."
            }
        ]
    },
    "Microsoft": {
        "color": "#0078D4",
        "extensions": [
            {
                "id": "VisualStudioExptTeam.vscodeintellicode",
                "name": "IntelliCode",
                "description": "AI-enhanced IntelliSense from Microsoft."
            }
        ]
    },
    "Google": {
        "color": "#4285F4",
        "extensions": [
            {
                "id": "Google.geminicodeassist",
                "name": "Gemini Code Assist",
                "description": "Gemini-powered AI coding assistant."
            },
            {
                "id": "Bini.vscode-gemini-assistant",
                "name": "Gemini Assistant (community)",
                "description": "Community Gemini chat/coding helper."
            }
        ]
    },
    "Amazon": {
        "color": "#FF9900",
        "extensions": [
            {
                "id": "AmazonWebServices.amazon-q-vscode",
                "name": "Amazon Q Developer",
                "description": "AI assistant replacing CodeWhisperer, integrated with AWS."
            },
            {
                "id": "AmazonWebServices.aws-toolkit-vscode",
                "name": "AWS Toolkit",
                "description": "Toolkit that includes CodeWhisperer/Q AI hooks."
            }
        ]
    },
    "OpenAI_ChatGPT": {
        "color": "#74AA9C",
        "extensions": [
            {
                "id": "openai.chatgpt",
                "name": "ChatGPT (official/3rd party)",
                "description": "ChatGPT IDE integration."
            },
            {
                "id": "genieai.chatgpt-vscode",
                "name": "ChatGPT – Genie AI",
                "description": "Popular ChatGPT extension for VS Code."
            },
            {
                "id": "DanielSanMedium.dscodegpt",
                "name": "CodeGPT",
                "description": "Multi-model AI assistant (supports OpenAI and others)."
            }
        ]
    },
    "Tabnine": {
        "color": "#FF7F50",
        "extensions": [
            {
                "id": "TabNine.tabnine-vscode",
                "name": "Tabnine",
                "description": "Proprietary AI autocomplete for code."
            },
            {
                "id": "TabNine.tabnine-vscode-self-hosted-updater",
                "name": "Tabnine Enterprise",
                "description": "Enterprise/self-hosted version of Tabnine."
            }
        ]
    },
    "Codeium": {
        "color": "#4C51BF",
        "extensions": [
            {
                "id": "Codeium.codeium",
                "name": "Codeium",
                "description": "Free AI coding assistant with autocomplete and chat."
            }
        ]
    },
    "Sourcegraph": {
        "color": "#FF3366",
        "extensions": [
            {
                "id": "sourcegraph.cody-ai",
                "name": "Cody AI",
                "description": "Sourcegraph's AI chat and code agent."
            }
        ]
    },
    "Blackbox": {
        "color": "#000000",
        "extensions": [
            {
                "id": "Blackboxapp.blackbox",
                "name": "Blackbox AI",
                "description": "AI completions and coding agent."
            }
        ]
    },
    "Pieces": {
        "color": "#6E56CF",
        "extensions": [
            {
                "id": "MeshIntelligentTechnologiesInc.pieces-vscode",
                "name": "Pieces Copilot",
                "description": "AI copilot for snippets, chat, and reuse."
            }
        ]
    },
    "Agents": {
        "color": "#FF6F61",
        "extensions": [
            {
                "id": "Continue.continue",
                "name": "Continue",
                "description": "Open-source AI copilot supporting multiple LLMs."
            },
            {
                "id": "saoudrizwan.claude-dev",
                "name": "Cline (Claude Dev)",
                "description": "Autonomous AI coding agent powered by Claude."
            },
            {
                "id": "RooVeterinaryInc.roo-cline",
                "name": "Roo Code",
                "description": "Cline variant by Roo."
            }
        ]
    },
    "Other": {
        "color": "#9CA3AF",
        "extensions": [
            {
                "id": "aminer.codegeex",
                "name": "CodeGeeX",
                "description": "AI coding assistant from IDEA Research."
            },
            {
                "id": "Bito.Bito",
                "name": "Bito",
                "description": "AI tool for reviews, tests, and explanations."
            },
            {
                "id": "mintlify.document",
                "name": "Mintlify Doc Writer",
                "description": "Generates documentation using AI."
            },
            {
                "id": "rjmacarthy.twinny",
                "name": "Twinny",
                "description": "Community AI completion/chat tool."
            }
        ]
    }
};
