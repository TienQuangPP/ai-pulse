'use strict';
/**
 * AI/LLM technology taxonomy.
 *
 * Each technology has regex `patterns` (strong signals) and optional `weak` patterns.
 * Everything is matched case-insensitively with word boundaries, avoiding the false
 * positives of naive substring matching ("rag" in "storage", "gpt" in "gptables").
 *
 * Weak patterns are ambiguous words (MCP = Minecraft Coder Pack, LoRa radio, GPT disk
 * partitions, "torch", "grok", "whisper"…). They only count when the same text also
 * contains at least one strong signal, or in dependency files where context is explicit.
 */

const CATEGORIES = [
  { id: 'llm', label: { en: 'LLM Providers', vi: 'Nhà cung cấp LLM' } },
  { id: 'framework', label: { en: 'Frameworks', vi: 'Framework' } },
  { id: 'agent', label: { en: 'Agents & MCP', vi: 'Agent & MCP' } },
  { id: 'vector', label: { en: 'Vector DBs', vi: 'Vector DB' } },
  { id: 'local', label: { en: 'Local / Self-host', vi: 'Chạy cục bộ' } },
  { id: 'technique', label: { en: 'Techniques', vi: 'Kỹ thuật' } },
  { id: 'genai', label: { en: 'Generative Media', vi: 'AI tạo sinh' } },
  { id: 'ml', label: { en: 'Classic ML / DL', vi: 'ML / DL' } },
];

const TECHNOLOGIES = [
  // LLM providers & models
  { id: 'openai', label: 'OpenAI', category: 'llm', patterns: ['openai'] },
  { id: 'chatgpt', label: 'ChatGPT', category: 'llm', patterns: ['chat-?gpt'] },
  { id: 'gpt', label: 'GPT', category: 'llm', patterns: ['gpt[-\\s]?\\d(?:\\.\\d)?o?(?:[-\\s]?(?:mini|turbo|nano|pro))?','gpt[-\\s]?(?:oss|neo|j|engineer|researcher)', 'custom gpts?'], weak: ['gpts?'] },
  { id: 'claude', label: 'Claude', category: 'llm', patterns: ['claude'] },
  { id: 'anthropic', label: 'Anthropic', category: 'llm', patterns: ['anthropic'] },
  { id: 'gemini', label: 'Gemini', category: 'llm', patterns: ['gemini', 'google[-_]?genai', 'generativeai'] },
  { id: 'llama', label: 'Llama', category: 'llm', patterns: ['llama[-\\s]?\\d?'] },
  { id: 'mistral', label: 'Mistral', category: 'llm', patterns: ['mistral', 'mixtral'] },
  { id: 'deepseek', label: 'DeepSeek', category: 'llm', patterns: ['deepseek'] },
  { id: 'qwen', label: 'Qwen', category: 'llm', patterns: ['qwen\\d?'] },
  { id: 'grok', label: 'Grok', category: 'llm', patterns: ['grok[-\\s]?\\d', 'xai[-\\s]grok', 'grok api'], weak: ['grok'] },
  { id: 'llm', label: 'LLM', category: 'llm', patterns: ['llms?', 'large language models?'] },

  // Frameworks
  { id: 'langchain', label: 'LangChain', category: 'framework', patterns: ['langchain'] },
  { id: 'langgraph', label: 'LangGraph', category: 'framework', patterns: ['langgraph'] },
  { id: 'llamaindex', label: 'LlamaIndex', category: 'framework', patterns: ['llama[-_\\s]?index'] },
  { id: 'huggingface', label: 'Hugging Face', category: 'framework', patterns: ['hugging[-\\s]?face', 'hf[-_]hub'], weak: ['transformers'] },
  { id: 'dspy', label: 'DSPy', category: 'framework', patterns: ['dspy'] },
  { id: 'semantickernel', label: 'Semantic Kernel', category: 'framework', patterns: ['semantic[-\\s]kernel'] },
  { id: 'aisdk', label: 'Vercel AI SDK', category: 'framework', patterns: ['ai[-\\s]sdk'] },

  // Agents
  { id: 'agent', label: 'AI Agent', category: 'agent', patterns: ['ai[-\\s]agents?', 'agentic', 'llm[-\\s]agents?'], weak: ['agents?'] },
  { id: 'mcp', label: 'MCP', category: 'agent', patterns: ['model context protocol', 'modelcontextprotocol', 'mcp[-\\s_]?(?:servers?|clients?|tools?|hosts?)', 'fastmcp'], weak: ['mcp'] },
  { id: 'autogen', label: 'AutoGen', category: 'agent', patterns: ['autogen'] },
  { id: 'crewai', label: 'CrewAI', category: 'agent', patterns: ['crew[-\\s]?ai'] },
  { id: 'toolcalling', label: 'Tool calling', category: 'agent', patterns: ['function[-\\s]calling', 'tool[-\\s]calling', 'tool[-\\s]use'] },
  { id: 'copilot', label: 'Copilot', category: 'agent', patterns: ['copilot'] },

  // Vector databases
  { id: 'vectordb', label: 'Vector DB', category: 'vector', patterns: ['vector[-\\s]?(?:database|db|store|search)s?'] },
  { id: 'pinecone', label: 'Pinecone', category: 'vector', patterns: ['pinecone'] },
  { id: 'chroma', label: 'Chroma', category: 'vector', patterns: ['chroma[-_]?db', 'chroma vector'] },
  { id: 'weaviate', label: 'Weaviate', category: 'vector', patterns: ['weaviate'] },
  { id: 'qdrant', label: 'Qdrant', category: 'vector', patterns: ['qdrant'] },
  { id: 'milvus', label: 'Milvus', category: 'vector', patterns: ['milvus'] },
  { id: 'pgvector', label: 'pgvector', category: 'vector', patterns: ['pgvector'] },
  { id: 'faiss', label: 'FAISS', category: 'vector', patterns: ['faiss'] },

  // Local / self-hosted inference
  { id: 'ollama', label: 'Ollama', category: 'local', patterns: ['ollama'] },
  { id: 'llamacpp', label: 'llama.cpp', category: 'local', patterns: ['llama\\.cpp', 'llamacpp'] },
  { id: 'vllm', label: 'vLLM', category: 'local', patterns: ['vllm'] },
  { id: 'gguf', label: 'GGUF', category: 'local', patterns: ['gguf'] },
  { id: 'lmstudio', label: 'LM Studio', category: 'local', patterns: ['lm[-\\s]?studio'] },

  // Techniques
  { id: 'rag', label: 'RAG', category: 'technique', patterns: ['rag', 'retrieval[-\\s]augmented'] },
  { id: 'embedding', label: 'Embeddings', category: 'technique', patterns: ['text[-_\\s]embeddings?', 'embedding[-\\s]models?', 'sentence[-_\\s]transformers', 'vector embeddings?'], weak: ['embeddings?'] },
  { id: 'finetune', label: 'Fine-tuning', category: 'technique', patterns: ['fine[-\\s]?tun(?:e|ed|ing)'] },
  { id: 'lora', label: 'LoRA', category: 'technique', patterns: ['qlora', 'lora[-\\s](?:adapters?|weights|training)', 'peft'], weak: ['lora'] },
  { id: 'prompt', label: 'Prompt engineering', category: 'technique', patterns: ['prompt[-\\s]engineering', 'system prompts?', 'prompt templates?'] },
  { id: 'rlhf', label: 'RLHF', category: 'technique', patterns: ['rlhf', 'rlaif'], weak: ['dpo'] },

  // Generative media
  { id: 'genai', label: 'Generative AI', category: 'genai', patterns: ['generative[-\\s]ai', 'gen[-\\s]?ai'] },
  { id: 'diffusion', label: 'Stable Diffusion', category: 'genai', patterns: ['stable[-\\s]diffusion', 'diffusion models?', 'comfyui', 'sdxl'] },
  { id: 'whisper', label: 'Whisper', category: 'genai', patterns: ['openai[-_\\s]?whisper', 'faster[-_]?whisper', 'whisper\\.cpp', 'whisperx'], weak: ['whisper'] },
  { id: 'tts', label: 'Text-to-speech', category: 'genai', patterns: ['text[-\\s]to[-\\s]speech'], weak: ['tts'] },

  // Classic ML / DL
  { id: 'pytorch', label: 'PyTorch', category: 'ml', patterns: ['pytorch'], weak: ['torch'] },
  { id: 'tensorflow', label: 'TensorFlow', category: 'ml', patterns: ['tensorflow', 'keras'] },
  { id: 'ml', label: 'Machine learning', category: 'ml', patterns: ['machine[-\\s]learning', 'ml[-\\s]model'] },
  { id: 'dl', label: 'Deep learning', category: 'ml', patterns: ['deep[-\\s]learning', 'neural[-\\s]networks?'] },
];

module.exports = { CATEGORIES, TECHNOLOGIES };
