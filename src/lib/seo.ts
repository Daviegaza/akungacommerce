import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants'

interface SEOData {
  title: string
  description: string
  image?: string
  url?: string
  type?: 'website' | 'product' | 'article'
  publishedTime?: string
  tags?: string[]
  price?: number
  currency?: string
  availability?: 'in_stock' | 'out_of_stock' | 'preorder'
  rating?: number
  reviewCount?: number
}

export function buildMetadata(data: SEOData) {
  const siteName = APP_NAME
  const fullTitle = data.title.includes(APP_NAME) ? data.title : `${data.title} — ${APP_NAME}`
  const url = data.url ?? (typeof window !== 'undefined' ? window.location.href : '')

  return {
    title: fullTitle,
    description: data.description,

    openGraph: {
      title: fullTitle,
      description: data.description,
      siteName,
      url,
      type: data.type ?? 'website',
      images: data.image ? [{ url: data.image, width: 1200, height: 630, alt: data.title }] : [],
      locale: 'en_US',
    },

    twitter: {
      card: 'summary_large_image' as const,
      title: fullTitle,
      description: data.description,
      images: data.image ? [data.image] : [],
    },

    other: {
      'og:site_name': siteName,
    },
  }
}

export function buildStructuredData(data: SEOData): string {
  if (data.type === 'product') {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: data.title,
      description: data.description,
      image: data.image,
      offers: {
        '@type': 'Offer',
        price: data.price,
        priceCurrency: data.currency ?? 'USD',
        availability: data.availability
          ? `https://schema.org/${data.availability === 'in_stock' ? 'InStock' : data.availability === 'out_of_stock' ? 'OutOfStock' : 'PreOrder'}`
          : 'https://schema.org/InStock',
      },
      ...(data.rating && {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: data.rating,
          reviewCount: data.reviewCount ?? 0,
        },
      }),
    })
  }

  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: APP_NAME,
    description: APP_DESCRIPTION,
    url: data.url ?? (typeof window !== 'undefined' ? window.location.origin : ''),
  })
}

// Generate a sitemap.xml string (server-side use)
export function generateSitemap(baseUrl: string): string {
  const urls = [
    { loc: '/', priority: 1.0, changefreq: 'daily' },
    { loc: '/products', priority: 0.9, changefreq: 'daily' },
    { loc: '/cart', priority: 0.3, changefreq: 'always' },
    { loc: '/checkout', priority: 0.3, changefreq: 'always' },
    { loc: '/account', priority: 0.5, changefreq: 'weekly' },
    { loc: '/search', priority: 0.2, changefreq: 'always' },
  ]

  const urlEntries = urls
    .map(
      ({ loc, priority, changefreq }) =>
        `  <url>
    <loc>${baseUrl}${loc}</loc>
    <priority>${priority}</priority>
    <changefreq>${changefreq}</changefreq>
  </url>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`
}
