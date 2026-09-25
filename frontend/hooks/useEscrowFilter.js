'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

export const DEFAULT_FILTERS = {
  status: '',
  role: '',
  sort: '',
  search: '',
  minAmount: '',
  maxAmount: '',
  dateFrom: '',
  dateTo: '',
};

export function useEscrowFilter(escrows = [], initialFilterOverrides = {}) {
  let searchParams = null;
  let router = null;
  let pathname = '';

  try {
    searchParams = useSearchParams();
    router = useRouter();
    pathname = usePathname() || '';
  } catch {
    // Graceful fallback for non-Next environments (e.g., isolated test suites)
  }

  const getFiltersFromSearchParams = useCallback((params) => {
    if (!params) return null;
    const urlFilters = {};
    if (params.has('status')) urlFilters.status = params.get('status') || '';
    if (params.has('role')) urlFilters.role = params.get('role') || '';
    if (params.has('sort')) urlFilters.sort = params.get('sort') || '';
    if (params.has('search')) urlFilters.search = params.get('search') || '';
    if (params.has('minAmount')) urlFilters.minAmount = params.get('minAmount') || '';
    if (params.has('maxAmount')) urlFilters.maxAmount = params.get('maxAmount') || '';
    if (params.has('dateFrom')) urlFilters.dateFrom = params.get('dateFrom') || '';
    if (params.has('dateTo')) urlFilters.dateTo = params.get('dateTo') || '';
    return Object.keys(urlFilters).length > 0 ? urlFilters : null;
  }, []);

  const [filters, setFilters] = useState(() => {
    const fromUrl = searchParams ? getFiltersFromSearchParams(searchParams) : null;
    return {
      ...DEFAULT_FILTERS,
      ...initialFilterOverrides,
      ...(fromUrl || {}),
    };
  });

  const isInternalUpdate = useRef(false);

  // Sync state when URL search params change (e.g. back/forward navigation or direct URL change)
  useEffect(() => {
    if (!searchParams) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const fromUrl = getFiltersFromSearchParams(searchParams);
    const newFilters = {
      ...DEFAULT_FILTERS,
      ...initialFilterOverrides,
      ...(fromUrl || {}),
    };

    setFilters((prev) => {
      const keys = Object.keys(DEFAULT_FILTERS);
      const changed = keys.some((k) => (prev[k] || '') !== (newFilters[k] || ''));
      return changed ? newFilters : prev;
    });
  }, [searchParams, getFiltersFromSearchParams, initialFilterOverrides]);

  const updateUrl = useCallback(
    (newFilters) => {
      if (!router || !pathname) return;
      const params = new URLSearchParams(searchParams ? searchParams.toString() : '');
      const filterKeys = ['status', 'role', 'sort', 'search', 'minAmount', 'maxAmount', 'dateFrom', 'dateTo'];

      filterKeys.forEach((key) => {
        const val = newFilters[key];
        if (val && val !== '') {
          params.set(key, val);
        } else {
          params.delete(key);
        }
      });

      const queryString = params.toString();
      const targetUrl = queryString ? `${pathname}?${queryString}` : pathname;
      isInternalUpdate.current = true;
      router.push(targetUrl, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const filtered = useMemo(() => {
    let result = (escrows || []).filter((e) => {
      if (!e) return false;

      // Status filter (case-insensitive)
      if (filters.status) {
        const itemStatus = (e.status || '').toLowerCase();
        const filterStatus = filters.status.toLowerCase();
        if (itemStatus !== filterStatus) return false;
      }

      // Role filter (supports client / contractor / freelancer)
      if (filters.role) {
        const itemRole = (e.role || '').toLowerCase();
        const filterRole = filters.role.toLowerCase();
        const matchesRole =
          itemRole === filterRole ||
          (filterRole === 'contractor' && itemRole === 'freelancer') ||
          (filterRole === 'freelancer' && itemRole === 'contractor');
        if (!matchesRole) return false;
      }

      // Text search
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const idStr = String(e.id || '').toLowerCase();
        const titleStr = (e.title || '').toLowerCase();
        const counterpartyStr = (e.counterparty || '').toLowerCase();
        const descStr = (e.description || '').toLowerCase();
        const matches =
          idStr.includes(q) ||
          titleStr.includes(q) ||
          counterpartyStr.includes(q) ||
          descStr.includes(q);
        if (!matches) return false;
      }

      // Amount range
      const rawAmount = e.amount ?? (typeof e.totalAmount === 'string' ? parseFloat(e.totalAmount.replace(/[^0-9.-]/g, '')) : e.totalAmount);
      const amountVal = Number(rawAmount);
      if (filters.minAmount && amountVal < Number(filters.minAmount)) return false;
      if (filters.maxAmount && amountVal > Number(filters.maxAmount)) return false;

      // Date range
      if (filters.dateFrom && e.createdAt && new Date(e.createdAt) < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && e.createdAt && new Date(e.createdAt) > new Date(filters.dateTo)) return false;

      return true;
    });

    // Sorting
    if (filters.sort) {
      result = [...result].sort((a, b) => {
        const getAmt = (x) => {
          const raw = x.amount ?? (typeof x.totalAmount === 'string' ? parseFloat(x.totalAmount.replace(/[^0-9.-]/g, '')) : x.totalAmount);
          return Number(raw) || 0;
        };
        const getDate = (x) => new Date(x.createdAt || 0).getTime();

        switch (filters.sort) {
          case 'amount_asc':
          case 'amount-asc':
            return getAmt(a) - getAmt(b);
          case 'amount_desc':
          case 'amount-desc':
            return getAmt(b) - getAmt(a);
          case 'oldest':
          case 'date_asc':
          case 'date-asc':
            return getDate(a) - getDate(b);
          case 'newest':
          case 'date_desc':
          case 'date-desc':
            return getDate(b) - getDate(a);
          default:
            return 0;
        }
      });
    }

    return result;
  }, [escrows, filters]);

  const setFilter = useCallback(
    (key, value) => {
      setFilters((prev) => {
        const next = { ...prev, [key]: value };
        updateUrl(next);
        return next;
      });
    },
    [updateUrl],
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    updateUrl(DEFAULT_FILTERS);
  }, [updateUrl]);

  const activeCount = useMemo(() => {
    return Object.values(filters).filter(Boolean).length;
  }, [filters]);

  return { filters, filtered, setFilter, resetFilters, activeCount };
}
