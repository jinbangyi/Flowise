import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { MarkdownTextSplitter, MarkdownTextSplitterParams } from 'langchain/text_splitter'
import { NodeHtmlMarkdown, TranslatorConfigObject } from 'node-html-markdown'
import { ElementNode } from 'node-html-markdown/dist/nodes'

// Helpers for custom translators (operate on node-html-parser elements)
const normalize = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim()

function isCardish(node: ElementNode | HTMLElement | ParentNode) {
    if (!node) return false

    const classAttr = (node && 'getAttribute' in node && node.getAttribute('class')) || ''
    const classTxt = typeof classAttr === 'string' ? classAttr : ''
    return /(rounded|min-h-|border|panel)/i.test(classTxt)
}

function isCardNode(node: ElementNode) {
    const t = normalize(node.textContent)
    const classHint = isCardish(node)
    const price = /\$\s*\d[\d,]*/.test(t)
    // Require a visible CTA inside this node to avoid matching grid wrappers
    let cta = false
    let ctaEl = null
    try {
        ctaEl = node.querySelector && node.querySelector('button, a[role="button"], a[href]')
        const ctaTxt = normalize(ctaEl && ctaEl.textContent)
        cta = /(try\s+minara|try\b|subscribe|buy|start|get)/i.test(ctaTxt)
    } catch { /* ignore */ }
    // Ensure the nearest cardish ancestor of CTA is this node (avoid parent containers)
    if (classHint && ctaEl) {
        let cur = ctaEl.parentNode
        while (cur && cur !== node) {
            if (isCardish(cur)) return false
            cur = cur.parentNode
        }
    }
    // For robustness, insist on card-ish styling AND a price AND a CTA
    return classHint && price && cta
}

function inferTitle(node: ElementNode) {
    // Prefer semantic headings
    let el = node.querySelector && node.querySelector('h1,h2,h3,h4,h5,h6')
    if (el) {
        const tt = normalize(el.textContent)
        if (tt) return tt
    }
    // Otherwise take the first short, non-numeric phrase near the top
    const candidates = (node.querySelectorAll && node.querySelectorAll('span,div,strong,em,b')) || []
    for (let i = 0; i < Math.min(candidates.length, 20); i++) {
        // Insert spacing at camel-case boundaries before processing
        const raw = normalize(candidates[i].textContent).replace(/([a-z])([A-Z])/g, '$1 $2')
        // Remove common badges/slogans
        const t = raw
            .replace(/\b(early access|per month|pay annually|save \d+%|try|minara)\b/ig, ' ')
            .replace(/\b(early|access)\b/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        if (!t) continue
        if (/[\$\d]{2,}/.test(t)) continue
        if (/per\s+month|save\s+\d+%|pay\s+annually|try\b|minara/i.test(t)) continue
        if (t.length <= 40) {
            // Prefer the first leading word-like token (avoid combined labels like "Lite Early Access")
            const token = (t.match(/[A-Za-z][A-Za-z0-9+_-]{1,30}/) || [t])[0]
            return token
        }
    }
    return null
}

const customTranslators: TranslatorConfigObject = {
    'div,section,article': ({ node, parent, base }) => {
        base = base || {}
        try {
            if (!node || !node.querySelector) return base
            const isCard = isCardNode(node)
            const parentIsCard = parent && isCardNode(parent)
            if (isCard && !parentIsCard) {
                const title = inferTitle(node) || 'Section'
                return {
                    ...base,
                    // Surround with an H2 heading; children render as usual
                    prefix: `## ${title}\n`,
                    surroundingNewlines: 2,
                }
            }
        } catch { /* ignore */ }
        return base
    },
    'footer': { ignore: true, recurse: true },
    'nav': { ignore: true, recurse: true },
}

class HtmlToMarkdownTextSplitter_TextSplitters implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    constructor() {
        this.label = 'HtmlToMarkdown Text Splitter'
        this.name = 'htmlToMarkdownTextSplitter'
        this.version = 1.0
        this.type = 'HtmlToMarkdownTextSplitter'
        this.icon = 'htmlToMarkdownTextSplitter.svg'
        this.category = 'Text Splitters'
        this.description = `Converts Html to Markdown and then split your content into documents based on the Markdown headers`
        this.baseClasses = [this.type, ...getBaseClasses(HtmlToMarkdownTextSplitter)]
        this.inputs = [
            {
                label: 'Chunk Size',
                name: 'chunkSize',
                type: 'number',
                description: 'Number of characters in each chunk. Default is 1000.',
                default: 1000,
                optional: true
            },
            {
                label: 'Chunk Overlap',
                name: 'chunkOverlap',
                type: 'number',
                description: 'Number of characters to overlap between chunks. Default is 200.',
                default: 200,
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const chunkSize = nodeData.inputs?.chunkSize as string
        const chunkOverlap = nodeData.inputs?.chunkOverlap as string

        const obj = {} as MarkdownTextSplitterParams

        if (chunkSize) obj.chunkSize = parseInt(chunkSize, 10)
        if (chunkOverlap) obj.chunkOverlap = parseInt(chunkOverlap, 10)

        const splitter = new HtmlToMarkdownTextSplitter(obj)

        return splitter
    }
}
class HtmlToMarkdownTextSplitter extends MarkdownTextSplitter implements MarkdownTextSplitterParams {
    constructor(fields?: Partial<MarkdownTextSplitterParams>) {
        {
            super(fields)
        }
    }
    splitText(text: string): Promise<string[]> {
        return new Promise((resolve) => {
            const markdown = NodeHtmlMarkdown.translate(
                text,
                {
                    useInlineLinks: false,
                    keepDataImages: false,
                    ignore: ['nav', 'script', 'style', 'noscript'],
                    blockElements: ['div', 'section', 'article', 'header', 'footer'],
                    textReplace: [
                        [/\n\n\n+/g, '\n\n'], // Remove excessive line breaks
                    ],
                },
                customTranslators
            )
            super.splitText(markdown).then((result) => {
                resolve(result)
            })
        })
    }
}
module.exports = { nodeClass: HtmlToMarkdownTextSplitter_TextSplitters }
