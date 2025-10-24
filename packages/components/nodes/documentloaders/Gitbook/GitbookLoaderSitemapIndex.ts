/**
 * Fixed GitBook Loader with multi-index sitemap support.
 *
 * This module extends the original GitbookLoader to support sitemap index files
 * that contain references to multiple sub-sitemaps.
 */

import type { CheerioAPI, Element } from 'cheerio'
import { Document } from '@langchain/core/documents'
import { GitbookLoader } from '@langchain/community/document_loaders/web/gitbook'
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'

/**
 * Extended GitBook loader with multi-index sitemap support.
 *
 * This loader supports both:
 * 1. Regular sitemaps (with <url> and <loc> tags)
 * 2. Sitemap index files (with <sitemap> tags referencing other sitemaps)
 */
export class GitbookLoaderFixed extends GitbookLoader {
  private readonly rootWebPath: string

  constructor(webPath: string, params?: { shouldLoadAllPaths?: boolean }) {
    super(webPath, params)
    this.rootWebPath = webPath
  }

  async overrideLoad() {
    const $ = await this.scrape();
    return this.buildDocuments($, this.webPath);
  }

  /**
   * Override load to pipe all-path requests through the enhanced sitemap handler.
   */
  async load(): Promise<Document[]> {
    if (this.shouldLoadAllPaths === true) {
      const $ = await this.scrape()
      return this.loadAllPathsWithIndexes($)
    }

    return this.overrideLoad()
  }

  /**
   * Fetch all relative paths from sitemap.
   *
   * Supports both regular sitemaps and sitemap index files.
   * If sitemap contains <sitemap> tags (sitemap index), it will
   * recursively fetch all sub-sitemaps.
   *
   * @param soup - Parsed sitemap XML (cheerio instance or similar)
   * @returns List of relative paths extracted from the sitemap(s)
   */
  protected async _get_paths(soup: CheerioAPI): Promise<string[]> {
    // Check if this is a sitemap index (contains <sitemap> tags)
    const sitemapTags = soup('sitemap')

    if (sitemapTags.length > 0) {
      // This is a sitemap index, fetch all sub-sitemaps
      console.log(`Found sitemap index with ${sitemapTags.length} sub-sitemaps`)
      const allPaths: string[] = []

      // Convert cheerio collection to array
      const sitemapArray = sitemapTags.toArray()

      for (let idx = 0; idx < sitemapArray.length; idx++) {
        const sitemapTag = soup(sitemapArray[idx])
        const locTag = sitemapTag.find('loc')

        if (locTag.length > 0) {
          const sitemapUrl = locTag.text().trim()
          console.log(
            `  [${idx + 1}/${sitemapArray.length}] Loading sub-sitemap: ${sitemapUrl}`
          )

          try {
            // Fetch and parse the sub-sitemap
            const subSoupArray = await CheerioWebBaseLoader.scrapeAll(
              [sitemapUrl],
              this.caller,
              this.timeout,
              this.textDecoder,
              this.headers ? { headers: this.headers } : undefined
            )
            const subSoup = subSoupArray[0]

            // Recursively get paths from sub-sitemap
            const subPaths = await this._get_paths(subSoup)
            console.log(`      → Found ${subPaths.length} URLs`)
            allPaths.push(...subPaths)
          } catch (e) {
            // If continueOnFailure is true, skip this sitemap
            console.warn(`Failed to load sitemap ${sitemapUrl}: ${e}`)
            throw e
          }
        }
      }

      console.log(`Total URLs found across all sitemaps: ${allPaths.length}`)
      return allPaths
    } else {
      // Regular sitemap, extract <loc> tags from <url> elements
      const locTags = soup('loc')
      const paths: string[] = []

      locTags.each((_: number, element: any) => {
        const locText = soup(element).text()
        try {
          const url = new URL(locText)
          paths.push(url.pathname)
        } catch (e) {
          // If URL parsing fails, try to use as-is
          paths.push(locText)
        }
      })

      return paths
    }
  }

  private async loadAllPathsWithIndexes($: CheerioAPI): Promise<Document[]> {
    const urls = await this._get_paths($)
    const documents: Document[] = []
    const scrapeOptions = this.headers ? { headers: this.headers } : undefined

    for (const url of urls) {
      const buildUrl = this.toAbsoluteUrl(url)
      console.log(`Fetching text from ${buildUrl}`)
      const html = await CheerioWebBaseLoader._scrape(
        buildUrl,
        this.caller,
        this.timeout,
        this.textDecoder,
        scrapeOptions
      )
      documents.push(...this.buildDocuments(html, buildUrl))
    }

    console.log(`Fetched ${documents.length} documents.`)
    return documents
  }

  private toAbsoluteUrl(url: string): string {
    try {
      return new URL(url, this.rootWebPath).toString()
    } catch (e) {
      console.warn(`Unable to resolve URL '${url}' relative to '${this.rootWebPath}', using raw value.`)
      return url
    }
  }

  // when load from gitbook page, should keep hierarchy of header
  private buildDocuments(html: CheerioAPI, source: string): Document[] {
    const pageContent = this.extractStructuredContent(html)
    const title = html('main h1').first().text().trim()
    const description = html('main h1').siblings('p').first().text().trim()

    return [
      new Document({
        pageContent,
        metadata: { source, title, description: description ? description : undefined }
      })
    ]
  }

  private extractStructuredContent(dom: CheerioAPI): string {
    const mainElement = dom('main').first()
    const root = mainElement.length ? mainElement : dom('body')

    if (!root.length) {
      return dom.root().text().trim()
    }

    const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim()

    const listToLines = (element: Element, depth = 0, ordered = false): string[] => {
      const lines: string[] = []

      dom(element)
        .children('li')
        .each((idx, li) => {
          const $li = dom(li)
          const cloned = $li.clone()
          cloned.children('ul,ol').remove()
          const text = normalize(cloned.text())

          if (text) {
            const marker = ordered ? `${idx + 1}.` : '-'
            lines.push(`${'  '.repeat(depth)}${marker} ${text}`)
          }

          $li.children('ul,ol').each((_, nested) => {
            lines.push(...listToLines(nested, depth + 1, dom(nested).is('ol')))
          })
        })

      return lines
    }

    const tableToLines = (element: Element): string => {
      const rows = dom(element).find('tr').toArray()
      if (!rows.length) {
        return normalize(dom(element).text())
      }

      const rowStrings = rows.map((row) => {
        const cells = dom(row)
          .children('th,td')
          .toArray()
          .map((cell) => normalize(dom(cell).text()))
        return cells.join(' | ')
      })

      return rowStrings.join('\n')
    }

    const blockSelectors = 'h1, h2, h3, h4, h5, h6, p, ul, ol, pre, blockquote, table'
    const sections = root.find(blockSelectors).toArray()
    const parts: string[] = []

    for (const section of sections) {
      const tag = section.tagName?.toLowerCase()
      if (!tag) {
        continue
      }

      const $section = dom(section)

      if (mainElement.length && !$section.closest('main').length) {
        continue
      }

      if (!$section.text().trim()) {
        continue
      }

      if ($section.parents('pre').length && tag !== 'pre') {
        continue
      }

      switch (tag) {
        case 'h1':
        case 'h2':
        case 'h3':
        case 'h4':
        case 'h5':
        case 'h6': {
          const level = Number.parseInt(tag.slice(1), 10) || 1
          const text = normalize($section.text())
          if (text) {
            const prefix = '#'.repeat(Math.min(level, 6))
            parts.push(`${prefix} ${text}`)
          }
          break
        }
        case 'p': {
          if ($section.closest('li').length) {
            break
          }
          const text = normalize($section.text())
          if (text) {
            parts.push(text)
          }
          break
        }
        case 'ul':
        case 'ol': {
          if ($section.closest('li').length) {
            break
          }
          const listLines = listToLines(section, 0, tag === 'ol')
          if (listLines.length) {
            parts.push(listLines.join('\n'))
          }
          break
        }
        case 'pre': {
          const codeText = $section.text().trimEnd()
          if (codeText) {
            const language = ($section.attr('data-language') ?? '').trim()
            const fenceHeader = language ? `\`\`\`${language}` : '```'
            parts.push([fenceHeader, codeText, '```'].join('\n'))
          }
          break
        }
        case 'blockquote': {
          const lines = $section
            .text()
            .split(/\r?\n/)
            .map((line) => normalize(line))
            .filter(Boolean)
            .map((line) => `> ${line}`)

          if (lines.length) {
            parts.push(lines.join('\n'))
          }
          break
        }
        case 'table': {
          const tableText = tableToLines(section)
          if (tableText) {
            parts.push(tableText)
          }
          break
        }
        default: {
          const text = normalize($section.text())
          if (text) {
            parts.push(text)
          }
          break
        }
      }
    }

    if (!parts.length) {
      return root.text().trim()
    }

    return parts.join('\n\n')
  }
}
