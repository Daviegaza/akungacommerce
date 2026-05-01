import type { Product, Review } from '@/types'
import { products as productData } from '@/data/products'
import { reviews as reviewData } from '@/data/reviews'

export { products } from '@/data/products'
export { reviews } from '@/data/reviews'

export function getProductById(id: string): Product | undefined {
  return productData.find((p) => p.id === id)
}

export function getProductBySlug(slug: string): Product | undefined {
  return productData.find((p) => p.slug === slug)
}

export function getFeaturedProducts(): Product[] {
  return productData.filter((p) => p.isFeatured)
}

export function getNewArrivals(): Product[] {
  return productData.filter((p) => p.isNewArrival)
}

export function getRelatedProducts(product: Product, limit = 4): Product[] {
  return productData
    .filter((p) => p.id !== product.id && (p.category === product.category || p.tags.some((t) => product.tags.includes(t))))
    .slice(0, limit)
}

export function getReviewsForProduct(productId: string): Review[] {
  return reviewData.filter((r) => r.productId === productId)
}

export function getProductsByCategory(category: string): Product[] {
  return productData.filter((p) => p.category === category)
}

export function searchProducts(query: string): Product[] {
  const q = query.toLowerCase()
  return productData.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.tags.some((t) => t.includes(q))
  )
}

export function getFilteredProducts(filters: {
  categories?: string[]
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  onSale?: boolean
  minRating?: number
}): Product[] {
  let result = [...productData]

  if (filters.categories && filters.categories.length > 0) {
    result = result.filter((p) => filters.categories!.includes(p.category))
  }
  if (filters.minPrice !== undefined) {
    result = result.filter((p) => p.price >= filters.minPrice!)
  }
  if (filters.maxPrice !== undefined) {
    result = result.filter((p) => p.price <= filters.maxPrice!)
  }
  if (filters.inStock) {
    result = result.filter((p) => p.inStock)
  }
  if (filters.onSale) {
    result = result.filter((p) => p.compareAtPrice !== null)
  }
  if (filters.minRating !== undefined) {
    result = result.filter((p) => p.rating >= filters.minRating!)
  }

  return result
}

export function getProductStats() {
  const total = productData.length
  const inStock = productData.filter((p) => p.inStock).length
  const onSale = productData.filter((p) => p.compareAtPrice !== null).length
  const categories = [...new Set(productData.map((p) => p.category))]
  const avgPrice = productData.reduce((sum, p) => sum + p.price, 0) / total
  const avgRating = productData.reduce((sum, p) => sum + p.rating, 0) / total

  return { total, inStock, onSale, categories: categories.length, avgPrice, avgRating }
}
