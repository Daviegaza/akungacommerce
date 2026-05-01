import type { Product, Review, User, CartItem, CheckoutFormData, Order } from '@/types'
import {
  products,
  getProductById,
  getFeaturedProducts,
  getNewArrivals,
  getRelatedProducts,
  getReviewsForProduct,
  searchProducts,
  getFilteredProducts,
  getProductStats,
} from '@/lib/products'
import { mockUser } from '@/data/users'

// Simulate network latency (150–700ms)
function delay(ms?: number): Promise<void> {
  const actual = ms ?? 150 + Math.random() * 550
  return new Promise((resolve) => setTimeout(resolve, actual))
}

// Simulate occasional errors (5% chance)
function maybeError(): void {
  if (Math.random() < 0.05) {
    throw new ApiError('A network error occurred. Please try again.', 500)
  }
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  hasMore: boolean
}

// Cache for deduplication
const cache = new Map<string, { data: unknown; timestamp: number }>()
const CACHE_TTL = 30_000 // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T
  }
  cache.delete(key)
  return null
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() })
}

// ─── Products API ───

export async function fetchProducts(params?: {
  page?: number
  pageSize?: number
  category?: string
  sort?: string
  filters?: Record<string, unknown>
}): Promise<PaginatedResponse<Product>> {
  const cacheKey = `products:${JSON.stringify(params)}`
  const cached = getCached<PaginatedResponse<Product>>(cacheKey)
  if (cached) return cached

  await delay()
  maybeError()

  const page = params?.page ?? 1
  const pageSize = params?.pageSize ?? 12
  let result = [...products]

  if (params?.category) {
    result = result.filter((p) => p.category === params.category)
  }

  if (params?.sort) {
    const sortMap: Record<string, (a: Product, b: Product) => number> = {
      featured: (a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0),
      newest: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      rating: (a, b) => b.rating - a.rating,
      bestselling: (a, b) => b.reviewCount - a.reviewCount,
    }
    const sorter = sortMap[params.sort] ?? sortMap.featured
    result.sort(sorter)
  }

  const total = result.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  const data = result.slice(start, start + pageSize)

  const response: PaginatedResponse<Product> = {
    data,
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  }

  setCache(cacheKey, response)
  return response
}

export async function fetchProduct(id: string): Promise<Product> {
  const cacheKey = `product:${id}`
  const cached = getCached<Product>(cacheKey)
  if (cached) return cached

  await delay(100)
  maybeError()

  const product = getProductById(id)
  if (!product) {
    throw new ApiError('Product not found', 404)
  }

  setCache(cacheKey, product)
  return product
}

export async function fetchFeaturedProducts(): Promise<Product[]> {
  const cacheKey = 'products:featured'
  const cached = getCached<Product[]>(cacheKey)
  if (cached) return cached

  await delay()
  maybeError()

  const data = getFeaturedProducts()
  setCache(cacheKey, data)
  return data
}

export async function fetchNewArrivals(): Promise<Product[]> {
  const cacheKey = 'products:new-arrivals'
  const cached = getCached<Product[]>(cacheKey)
  if (cached) return cached

  await delay()
  maybeError()

  const data = getNewArrivals()
  setCache(cacheKey, data)
  return data
}

export async function fetchRelatedProducts(productId: string, limit = 4): Promise<Product[]> {
  const cacheKey = `products:related:${productId}:${limit}`
  const cached = getCached<Product[]>(cacheKey)
  if (cached) return cached

  await delay()
  maybeError()

  const product = getProductById(productId)
  if (!product) throw new ApiError('Product not found', 404)

  const data = getRelatedProducts(product, limit)
  setCache(cacheKey, data)
  return data
}

export async function fetchProductReviews(productId: string): Promise<Review[]> {
  const cacheKey = `reviews:${productId}`
  const cached = getCached<Review[]>(cacheKey)
  if (cached) return cached

  await delay()
  maybeError()

  const data = getReviewsForProduct(productId)
  setCache(cacheKey, data)
  return data
}

export async function searchProductsApi(query: string): Promise<Product[]> {
  if (!query.trim()) return []

  const cacheKey = `search:${query}`
  const cached = getCached<Product[]>(cacheKey)
  if (cached) return cached

  await delay(80)
  maybeError()

  const data = searchProducts(query)
  setCache(cacheKey, data)
  return data
}

export async function fetchFilteredProducts(filters: {
  categories?: string[]
  minPrice?: number
  maxPrice?: number
  inStock?: boolean
  onSale?: boolean
  minRating?: number
  page?: number
  pageSize?: number
}): Promise<PaginatedResponse<Product>> {
  await delay()
  maybeError()

  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 12
  const result = getFilteredProducts(filters)
  const total = result.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize

  return {
    data: result.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages,
    hasMore: page < totalPages,
  }
}

export async function fetchProductStats() {
  const cached = getCached<ReturnType<typeof getProductStats>>('stats')
  if (cached) return cached

  await delay()
  maybeError()

  const data = getProductStats()
  setCache('stats', data)
  return data
}

// ─── Cart API ───

export async function validateCart(items: CartItem[]): Promise<{ valid: boolean; issues: string[] }> {
  await delay(100)

  const issues: string[] = []
  for (const item of items) {
    const product = getProductById(item.productId)
    if (!product) {
      issues.push(`${item.name} is no longer available`)
    } else if (!product.inStock) {
      issues.push(`${product.name} is out of stock`)
    } else if (item.quantity > product.stockCount) {
      issues.push(`Only ${product.stockCount} units of ${product.name} are available`)
    }
  }

  return { valid: issues.length === 0, issues }
}

// ─── Checkout API ───

export async function submitCheckout(formData: CheckoutFormData, items: CartItem[]): Promise<Order> {
  await delay(800)
  maybeError()

  if (!formData.email || !formData.firstName || !formData.address) {
    throw new ApiError('Please fill in all required fields', 400)
  }

  if (items.length === 0) {
    throw new ApiError('Your cart is empty', 400)
  }

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0)

  return {
    id: `AK-${Date.now().toString(36).toUpperCase()}`,
    date: new Date().toISOString(),
    status: 'processing',
    total,
    items,
    trackingNumber: null,
  }
}

// ─── User API ───

export async function fetchUser(): Promise<User> {
  await delay(200)
  maybeError()
  return mockUser
}

export async function loginUser(email: string, _password: string): Promise<{ user: User; token: string }> {
  await delay(400)

  if (!email.includes('@')) {
    throw new ApiError('Invalid email address', 400)
  }

  return {
    user: mockUser,
    token: `ak_token_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
  }
}

export async function addToWishlist(productId: string): Promise<string[]> {
  await delay(200)
  if (!mockUser.wishlist.includes(productId)) {
    mockUser.wishlist.push(productId)
  }
  return mockUser.wishlist
}

export async function removeFromWishlist(productId: string): Promise<string[]> {
  await delay(200)
  mockUser.wishlist = mockUser.wishlist.filter((id) => id !== productId)
  return mockUser.wishlist
}

// ─── Utility ───

export function clearApiCache(): void {
  cache.clear()
}
