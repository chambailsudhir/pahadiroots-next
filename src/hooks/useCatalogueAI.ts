'use client';
// ── src/hooks/useCatalogueAI.ts ──────────────────────────────────────────────
// AI content generation and management for the catalogue product modal.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useCallback } from 'react';
import { api } from '@/lib/api';

interface Category {
  id: string | number;
  name: string;
}

interface AiContent {
  description: string;
  benefits: string[];
  how_to_use: string[];
  storage_tips: string[];
  who_should_buy: string;
  generated_at: string;
  provider: string;
  approved?: boolean;
}

interface GenerateAIArgs {
  productId: string | number;
  productName: string;
  categoryId: string | number;
  tags?: string;
}

interface UseCatalogueAIOptions {
  categories?: Category[];
  onAlert?: (msg: any) => void;
  onConfirm?: (msg: any) => Promise<boolean>;
}

function safeParse<T>(str: string | null | undefined, fallback: T): T {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

/**
 * AI content generation, preview, save, and discard for a product.
 *
 * Bug #9 FIX — dirty-field protection:
 *   aiDirty tracks whether the user has manually edited aiSaved content
 *   after it was last loaded/generated. If dirty and admin presses
 *   "Regenerate", a confirm() prompt warns before overwriting.
 *   This prevents silent overwrite of manual edits.
 *
 * W1 FIX — accessible dialog support:
 *   onAlert and onConfirm callbacks replace browser alert()/confirm() so
 *   callers can supply accessible in-page dialogs (showToast / showConfirm).
 *   Defaults fall back to browser APIs so the hook works standalone.
 */
export function useCatalogueAI({
  categories = [],
  onAlert   = (msg: any)       => { alert(msg); },
  onConfirm = async (msg: any) => window.confirm(msg),
}: UseCatalogueAIOptions = {}) {
  const [aiLoading,  setAiLoading]  = useState(false);
  const [aiPreview,  setAiPreview]  = useState<AiContent | null>(null);
  const [aiSaved,    setAiSaved]    = useState<AiContent | null>(null);
  const [aiError,    setAiError]    = useState('');
  // Bug #9: track whether user has manually edited the saved AI content
  const [aiDirty,    setAiDirty]    = useState(false);
  const aiAbortRef                  = useRef<AbortController | null>(null);

  const loadAiContent = useCallback(async (productId: string | number) => {
    if (!productId) return;
    // Loading fresh content clears the dirty flag
    setAiDirty(false);
    try {
      const aiRows = await api.get('product_ai_content',
        `product_id=eq.${productId}&order=generated_at.desc`
      ).catch(() => null);

      if (aiRows?.length) {
        const byField: Record<string, any> = {};
        aiRows.forEach((r: any) => { byField[r.field_name] = r; });
        setAiSaved({
          description:    byField.description?.content || '',
          benefits:       safeParse(byField.benefits?.content, []),
          how_to_use:     safeParse(byField.how_to_use?.content, []),
          storage_tips:   safeParse(byField.storage_tips?.content, []),
          who_should_buy: byField.who_should_buy?.content || '',
          generated_at:   byField.description?.generated_at || new Date().toISOString(),
          provider:       byField.description?.provider || 'claude',
          approved:       byField.description?.approved || false,
        });
        return;
      }

      // Fallback: legacy product columns
      const rows = await api.get('products',
        `select=ai_description,ai_health_benefits,ai_how_to_use,ai_storage_tips,ai_who_should_buy,ai_generated_at,ai_provider&id=eq.${productId}`
      );
      const p = rows?.[0];
      if (p?.ai_description) {
        setAiSaved({
          description:    p.ai_description,
          benefits:       safeParse(p.ai_health_benefits, []),
          how_to_use:     safeParse(p.ai_how_to_use, []),
          storage_tips:   safeParse(p.ai_storage_tips, []),
          who_should_buy: p.ai_who_should_buy || '',
          generated_at:   p.ai_generated_at,
          provider:       p.ai_provider || 'claude',
        });
      } else {
        setAiSaved(null);
      }
    } catch { setAiSaved(null); }
  }, []);

  const handleGenerateAI = useCallback(async ({ productId, productName, categoryId, tags }: GenerateAIArgs) => {
    if (!productId) {
      onAlert('Please save the product first before generating AI content.');
      return;
    }

    // Bug #9 FIX: if user has manually edited content, warn before overwriting
    if (aiDirty && aiSaved) {
      const proceed = await onConfirm(
        `You have manually edited the AI content.\n\nRegenerating will replace it with new AI output. Your manual edits will be lost.\n\nContinue?`
      );
      if (!proceed) return;
    }

    // Also warn if there is an unsaved preview (user clicked Generate twice)
    if (aiPreview) {
      const proceed = await onConfirm(
        `A new AI draft is already waiting for your review.\n\nRegenerating will replace it. Continue?`
      );
      if (!proceed) return;
    }

    if (aiAbortRef.current) aiAbortRef.current.abort();
    aiAbortRef.current = new AbortController();
    setAiLoading(true);
    setAiError('');
    try {
      // SEC-1 FIX: pr_token is no longer stored in sessionStorage (token lives in the
      // httpOnly cookie exclusively since the SEC-1 session-migration). Reading
      // sessionStorage.getItem('pr_token') always returns null, making the
      // x-session-token header empty and causing a 401 if the cookie is the only auth.
      //
      // Fix: remove the dead sessionStorage read and add credentials:'include' so the
      // browser automatically sends the httpOnly pr_token cookie — matching the pattern
      // used by api.js (which has always used credentials:'include').
      const catName = categories.find((c: Category) => c.id === categoryId)?.name || '';
      const res = await fetch('/api/admin', {
        method: 'POST',
        signal: aiAbortRef.current.signal,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_ai_content', productId,
          name: productName, category: catName, ingredients: tags || '',
        }),
      });
      const json = await res.json();
      if (!res.ok) { setAiError(json.error || 'Generation failed. Please try again.'); return; }
      await loadAiContent(productId);
      setAiError('');
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiError('Network error — check your connection and try again.');
    } finally {
      setAiLoading(false);
    }
  }, [categories, loadAiContent, aiDirty, aiSaved, aiPreview, onAlert, onConfirm]);

  const handleSaveAI = useCallback(async (productId: string | number) => {
    if (!aiPreview || !productId) return;
    try {
      const fields = [
        { field_name: 'description',    content: aiPreview.description || '' },
        { field_name: 'benefits',       content: JSON.stringify(aiPreview.benefits || []) },
        { field_name: 'how_to_use',     content: JSON.stringify(aiPreview.how_to_use || []) },
        { field_name: 'storage_tips',   content: JSON.stringify(aiPreview.storage_tips || []) },
        { field_name: 'who_should_buy', content: aiPreview.who_should_buy || '' },
      ];
      await Promise.all(fields.map(f =>
        api.post('product_ai_content', {
          product_id: productId, field_name: f.field_name,
          content: f.content, provider: aiPreview.provider || 'claude',
          approved: false, generated_at: new Date().toISOString(),
        }).catch(() =>
          api.patch('product_ai_content',
            `product_id=eq.${productId}&field_name=eq.${f.field_name}`,
            { content: f.content, provider: aiPreview.provider || 'claude',
              approved: false, generated_at: new Date().toISOString() })
        )
      ));
      await api.patch('products', `id=eq.${productId}`, {
        ai_description:  aiPreview.description,
        ai_generated_at: new Date().toISOString(),
        ai_provider:     aiPreview.provider || 'claude',
      }).catch(() => {});
      setAiSaved({ ...aiPreview, generated_at: new Date().toISOString() });
      setAiPreview(null);
      // Saving clears dirty flag — content is now in sync with DB
      setAiDirty(false);
      setAiError('');
    } catch (e: any) {
      setAiError('Failed to save: ' + e.message);
    }
  }, [aiPreview]);

  const handleDiscardAI = useCallback(() => {
    setAiPreview(null);
    setAiError('');
    // Discard does NOT clear aiDirty — user's manual edits to aiSaved remain dirty
  }, []);

  /**
   * Call this when user manually edits the saved AI text in the UI.
   * Marks the content dirty so handleGenerateAI will warn before overwriting.
   */
  const markAiDirty = useCallback(() => setAiDirty(true), []);

  return {
    aiLoading, aiPreview, setAiPreview,
    aiSaved, setAiSaved, aiError, setAiError,
    aiDirty, markAiDirty,
    loadAiContent, handleGenerateAI, handleSaveAI, handleDiscardAI,
  };
}
