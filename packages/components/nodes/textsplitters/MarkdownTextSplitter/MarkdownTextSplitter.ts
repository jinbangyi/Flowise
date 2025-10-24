import { INode, INodeData, INodeParams } from '../../../src/Interface'
import { getBaseClasses } from '../../../src/utils'
import { MarkdownTextSplitter, MarkdownTextSplitterParams } from 'langchain/text_splitter'

class MarkdownTextSplitter_TextSplitters implements INode {
    label: string
    name: string
    version: number
    description: string
    type: string
    icon: string
    category: string
    baseClasses: string[]
    inputs: INodeParams[]

    private readonly defaultStopwords: Set<string> = new Set([
        // English
        'the',
        'and',
        'is',
        'in',
        'to',
        'of',
        'a',
        'for',
        'on',
        'with',
        'as',
        'by',
        'an',
        'be',
        'or',
        'at',
        'from',
        'that',
        'this',
        'it',
        'are',
        'was',
        'were',
        'but',
        'not',
        'have',
        'has',
        'had',
        'you',
        'your',
        'we',
        'they',
        'their',
        'our',
        'can',
        'will',
        'would',
        'should',
        'could',
        'about',
        'into',
        'over',
        'after',
        'before',
        'between',
        'within',
        'without',
        'than',
        'then',
        'there',
        'here',
        'when',
        'where',
        'how',
        'what',
        'which',
        'who',
        'whom',
        'why',
        'also',
        'such',
        'more',
        'most',
        'some',
        'any',
        'each',
        'other',
        'new',
        'use',
        'using',
        'used',
        'via',
        'per',
        // Chinese common function words (very small set to avoid over-filtering)
        '的',
        '了',
        '在',
        '和',
        '是',
        '也',
        '有',
        '我',
        '我们',
        '你',
        '你们',
        '他',
        '他们',
        '她',
        '她们',
        '它',
        '它们',
        '这',
        '那',
        '与',
        '及',
        '并',
        '或',
        '而',
        '其',
        '于',
        '对',
        '中',
        '为',
        '到',
        '从',
        '上',
        '下',
    ]);

    constructor() {
        this.label = 'Markdown Text Splitter'
        this.name = 'markdownTextSplitter'
        this.version = 1.1
        this.type = 'MarkdownTextSplitter'
        this.icon = 'markdownTextSplitter.svg'
        this.category = 'Text Splitters'
        this.description = `Split your content into documents based on the Markdown headers`
        this.baseClasses = [this.type, ...getBaseClasses(MarkdownTextSplitter)]
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
            },
            {
                label: 'Split by Headers',
                name: 'splitByHeaders',
                type: 'options',
                description: 'Split documents at specified header levels. Headers will be included with their content.',
                default: 'disabled',
                options: [
                    {
                        label: 'Disabled',
                        name: 'disabled'
                    },
                    {
                        label: '# Headers (H1)',
                        name: 'h1'
                    },
                    {
                        label: '## Headers (H2)',
                        name: 'h2'
                    },
                    {
                        label: '### Headers (H3)',
                        name: 'h3'
                    },
                    {
                        label: '#### Headers (H4)',
                        name: 'h4'
                    },
                    {
                        label: '##### Headers (H5)',
                        name: 'h5'
                    },
                    {
                        label: '###### Headers (H6)',
                        name: 'h6'
                    }
                ],
                optional: true
            }
        ]
    }

    async init(nodeData: INodeData): Promise<any> {
        const chunkSize = nodeData.inputs?.chunkSize as string
        const chunkOverlap = nodeData.inputs?.chunkOverlap as string
        const splitByHeaders = nodeData.inputs?.splitByHeaders as string

        const obj = {} as MarkdownTextSplitterParams

        if (chunkSize) obj.chunkSize = parseInt(chunkSize, 10)
        if (chunkOverlap) obj.chunkOverlap = parseInt(chunkOverlap, 10)

        const splitter = new MarkdownTextSplitter(obj)

        if (splitByHeaders && splitByHeaders !== 'disabled') {
            return {
                createDocuments: async (texts: string[]) => {
                    const results = []

                    for (const text of texts) {
                        const { chunks, parentTitle } = await this.splitByHeaders(text, splitByHeaders, splitter)
                        for (const chunk of chunks) {
                            results.push({
                                pageContent: chunk,
                                metadata: this.createChunkMetadata(chunk, {}, parentTitle)
                            })
                        }
                    }

                    return results
                },
                splitDocuments: async (documents: any[]) => {
                    const results = []

                    for (const doc of documents) {
                        const { chunks, parentTitle } = await this.splitByHeaders(doc.pageContent, splitByHeaders, splitter)
                        for (const chunk of chunks) {
                            results.push({
                                pageContent: chunk,
                                metadata: this.createChunkMetadata(chunk, doc.metadata, parentTitle)
                            })
                        }
                    }

                    return results
                },
                splitText: async (text: string) => {
                    const { chunks } = await this.splitByHeaders(text, splitByHeaders, splitter)
                    return chunks
                }
            }
        }

        return splitter
    }

    /**
     * If the chunk size is lower then 500 characters, 
     *   the chunk should combine to next chunk, 
     *   if is the last chunk, should combine to previous chunk
     *   if only one chunk, return as is
     * if the chunk size is greater than 1536 characters,
     *   the chunk should be split by next headerLevel if exists
     */
    private async splitByHeaders(
        text: string,
        headerLevel: string,
        fallbackSplitter: any
    ): Promise<{ chunks: string[]; parentTitle?: string }> {
        const maxLevel = this.getHeaderLevel(headerLevel)
        if (maxLevel === 0) return { chunks: await fallbackSplitter.splitText(text) }

        const lines = text.split('\n')
        const sections: string[] = []
        let currentSection: string[] = []
        const prefaceLines: string[] = []
        let seenHeader = false

        for (const line of lines) {
            const isHeader = line.startsWith('#') && line.match(/^#{1,6}\s/)
            const headerDepth = isHeader ? line.match(/^(#+)/)?.[1]?.length || 0 : 0

            if (isHeader && headerDepth <= maxLevel) {
                if (seenHeader && currentSection.length > 0) {
                    sections.push(currentSection.join('\n').trim())
                }

                currentSection = [line]
                seenHeader = true
            } else if (seenHeader) {
                currentSection.push(line)
            } else {
                prefaceLines.push(line)
            }
        }

        if (seenHeader && currentSection.length > 0) {
            sections.push(currentSection.join('\n').trim())
        }

        if (!seenHeader) {
            return { chunks: await fallbackSplitter.splitText(text) }
        }

        // content before first header is treated as parentTitle
        const parentTitle = prefaceLines.join('\n').trim() || undefined
        const filteredSections = sections.filter((section) => section.length > 0)
        const expandedSections = await this.expandLargeSections(filteredSections, headerLevel, fallbackSplitter)
        const adjustedChunks = this.combineSmallSections(expandedSections)

        return {
            chunks: adjustedChunks,
            parentTitle
        }
    }

    private async expandLargeSections(
        sections: string[],
        headerLevel: string,
        fallbackSplitter: any
    ): Promise<string[]> {
        if (sections.length === 0) return []

        const result: string[] = []
        // 128*3*4 = 1536
        const maxSectionLength = 1536

        for (const section of sections) {
            if (section.length > maxSectionLength) {
                const nextHeaderLevel = this.getNextHeaderLevel(headerLevel)
                let handled = false

                if (nextHeaderLevel) {
                    const { chunks } = await this.splitByHeaders(section, nextHeaderLevel, fallbackSplitter)
                    if (chunks.length > 1 || (chunks.length === 1 && chunks[0] !== section)) {
                        result.push(...chunks)
                        handled = true
                    }
                }

                if (!handled) {
                    const fallbackChunks = await fallbackSplitter.splitText(section)
                    if (Array.isArray(fallbackChunks) && fallbackChunks.length > 0) {
                        if (fallbackChunks.length > 1 || fallbackChunks[0] !== section) {
                            result.push(...fallbackChunks)
                            handled = true
                        }
                    }
                }

                if (!handled) {
                    result.push(section)
                }

                continue
            }

            result.push(section)
        }

        return result
    }

    private combineSmallSections(sections: string[]): string[] {
        if (sections.length <= 1) return sections

        const working = [...sections]
        const result: string[] = []
        // 128*1*4 / 4 = 128
        const minSectionLength = 128

        let index = 0
        while (index < working.length) {
            const current = working[index]

            if (current.length < minSectionLength) {
                if (index < working.length - 1) {
                    working[index + 1] = this.mergeChunks(current, working[index + 1])
                } else if (result.length > 0) {
                    const lastIdx = result.length - 1
                    result[lastIdx] = this.mergeChunks(result[lastIdx], current)
                } else {
                    result.push(current)
                }

                index += 1
                continue
            }

            result.push(current)
            index += 1
        }

        return result
    }

    private mergeChunks(left: string, right: string): string {
        if (!left) return right
        if (!right) return left

        const needsSeparator = !left.endsWith('\n') && !right.startsWith('\n')
        const separator = needsSeparator ? '\n\n' : ''

        return `${left}${separator}${right}`
    }

    private getNextHeaderLevel(current: string): string | undefined {
        const currentLevel = this.getHeaderLevel(current)
        if (currentLevel <= 0 || currentLevel >= 6) return undefined
        return `h${currentLevel + 1}`
    }

    private getHeaderLevel(headerLevel: string): number {
        switch (headerLevel) {
            case 'h1':
                return 1
            case 'h2':
                return 2
            case 'h3':
                return 3
            case 'h4':
                return 4
            case 'h5':
                return 5
            case 'h6':
                return 6
            default:
                return 0
        }
    }

    private createChunkMetadata(
        chunk: string,
        baseMetadata: Record<string, any> = {},
        parentTitle?: string
    ): Record<string, any> {
        const sectionTitle = this.extractSectionTitle(chunk) ?? baseMetadata?.sectionTitle ?? baseMetadata?.title
        const keywords: string[] = []
        if (sectionTitle) {
            keywords.push(...this.buildKeywords(sectionTitle))
        }
        keywords.push(...this.extractKeywords(chunk, 5))

        const normalizedParentTitle = parentTitle?.trim()

        return {
            ...baseMetadata,
            sectionTitle,
            // Remove duplicates
            keywords: Array.from(new Set(keywords)),
            parentTitle: normalizedParentTitle || baseMetadata?.parentTitle,
            originalText: chunk
        }
    }

    private extractSectionTitle(chunk: string): string | undefined {
        const lines = chunk
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)

        for (const line of lines) {
            const headerMatch = line.match(/^#{1,6}\s+(.*)$/)
            if (headerMatch) {
                return headerMatch[1].trim()
            }
        }

        return lines[0]
    }

    private buildKeywords(text: string): string[] {
        const normalized = text
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((word) => word.length > 2)

        const unique = Array.from(new Set(normalized))
        return unique.slice(0, 10)
    }

    private extractKeywords(text: string, topN = 8): string[] {
        try {
            const normalized = (text || '')
                .toLowerCase()
                .replace(/[^\p{L}\p{N}\s]/gu, ' ') // keep letters/numbers/spaces in all languages
                .replace(/\s+/g, ' ') // collapse whitespace
                .trim();

            if (!normalized) return [];

            const tokens = normalized.split(' ');

            const frequency = new Map<string, number>();

            for (const token of tokens) {
                if (!token) continue;
                if (token.length <= 1) continue; // skip single char tokens (too noisy)
                if (this.defaultStopwords.has(token)) continue;
                const prev = frequency.get(token) ?? 0;
                frequency.set(token, prev + 1);
            }

            const sorted = Array.from(frequency.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, topN)
                .filter(([term, freq]) => freq > 2) // only keep terms that appear more than once
                .map(([term]) => term);

            return sorted;
        } catch (error) {
            console.warn('Keyword extraction failed, returning empty list');
            return [];
        }
    }
}

module.exports = { nodeClass: MarkdownTextSplitter_TextSplitters }
