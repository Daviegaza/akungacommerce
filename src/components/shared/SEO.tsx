import { useEffect } from 'react'

interface SEOProps {
  title: string
  description: string
  image?: string
  type?: 'website' | 'product' | 'article'
  publishedTime?: string
  structuredData?: string
}

export function SEO({ title, description, image, type = 'website', publishedTime, structuredData }: SEOProps) {
  useEffect(() => {
    document.title = title.includes('Akunga') ? title : `${title} — Akunga`

    setMeta('description', description)
    setMeta('og:title', title)
    setMeta('og:description', description)
    setMeta('og:type', type)
    if (image) setMeta('og:image', image)
    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:title', title)
    setMeta('twitter:description', description)
    if (image) setMeta('twitter:image', image)
    if (publishedTime) setMeta('article:published_time', publishedTime)

    // Structured data
    if (structuredData) {
      const existing = document.querySelector('script[type="application/ld+json"]')
      if (existing) existing.remove()
      const script = document.createElement('script')
      script.type = 'application/ld+json'
      script.textContent = structuredData
      document.head.appendChild(script)
    }

    return () => {
      // Clean up structured data on unmount
      const existing = document.querySelector('script[type="application/ld+json"]')
      if (existing) existing.remove()
    }
  }, [title, description, image, type, publishedTime, structuredData])

  return null
}

function setMeta(name: string, content: string) {
  let element: HTMLMetaElement | null

  if (name.startsWith('og:') || name.startsWith('twitter:')) {
    element = document.querySelector(`meta[property="${name}"]`)
    if (!element) {
      element = document.createElement('meta')
      element.setAttribute('property', name)
      document.head.appendChild(element)
    }
  } else {
    element = document.querySelector(`meta[name="${name}"]`)
    if (!element) {
      element = document.createElement('meta')
      element.setAttribute('name', name)
      document.head.appendChild(element)
    }
  }

  element.setAttribute('content', content)
}
