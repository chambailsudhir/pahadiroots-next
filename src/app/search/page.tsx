'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import useSWR from 'swr'
import { supabase } from '@/lib/supabase'
import { normalizeProducts } from '@/lib/normalizeProduct'
import ProductCard from '@/components/product/ProductCard'
import { ProductGridSkeleton } from '@/components/ui/Skeleton'
import type { Product } from '@/types'

function SearchContent() {
  const searchParams = useSearchParams()
  const q = searchParams.get('q')?.trim() || ''

  const { data: results, isLoading } = useSWR<Product[]>(
    q ? `search-full-${q}` : null,
    async () => {
      const { data } = await supabase
        .from('products')
        .select(`
          id, name, slug, emoji, price, mrp, available_stock, gst_rate,
          image_url, unit_label, badges, category_id, is_deleted, status,
          categories:categories(id, name, slug),
          product_variants(id, price, mrp, variant_value, available_stock, is_active)
        `)
        .eq('is_deleted', false)
        .eq('status', 'active')
        .or(`name.ilike.%${q}%,tags.ilike.%${q}%`)
        .limit(48)
      return normalizeProducts(data ?? [])