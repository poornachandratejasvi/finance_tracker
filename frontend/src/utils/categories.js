// Category display metadata: resolve an icon KEY (stored in the DB) to a MUI icon
// component, and provide a cached hook that maps a category NAME -> {icon,color,kind}.
import { useEffect, useState } from 'react';
import {
  Restaurant, ShoppingBag, DirectionsBus, ReceiptLong, Movie, LocalHospital,
  LocalAtm, TrendingUp, SwapHoriz, Payments, MoreHoriz, HelpOutline, Category,
  Home, DirectionsCar, Flight, Pets, School, FitnessCenter, Fastfood,
  LocalGroceryStore, Bolt, Phone, Savings, CardGiftcard, LocalCafe, Checkroom,
  Spa, SportsEsports, Work, Wifi, WaterDrop, Celebration, ChildCare,
} from '@mui/icons-material';
import { getCategories } from '../services/api';

// icon KEY -> component. Unknown keys fall back to a generic Category icon.
export const CATEGORY_ICONS = {
  Restaurant, ShoppingBag, DirectionsBus, ReceiptLong, Movie, LocalHospital,
  LocalAtm, TrendingUp, SwapHoriz, Payments, MoreHoriz, HelpOutline, Category,
  Home, DirectionsCar, Flight, Pets, School, FitnessCenter, Fastfood,
  LocalGroceryStore, Bolt, Phone, Savings, CardGiftcard, LocalCafe, Checkroom,
  Spa, SportsEsports, Work, Wifi, WaterDrop, Celebration, ChildCare,
};

export const ICON_KEYS = Object.keys(CATEGORY_ICONS);

export const getCategoryIconComponent = (iconKey) => CATEGORY_ICONS[iconKey] || Category;

const DEFAULT_META = { icon: 'Category', color: '#bab0ac', kind: 'expense' };

// Module-level cache so many components share a single fetch.
let _cache = null;
let _pending = null;
const _subscribers = new Set();

const _buildMap = (list) => {
  const byName = {};
  (list || []).forEach((c) => {
    byName[c.name] = { icon: c.icon, color: c.color, kind: c.kind, id: c.id };
  });
  return { list: list || [], byName };
};

export const loadCategories = async (force = false) => {
  if (_cache && !force) return _cache;
  if (_pending && !force) return _pending;
  _pending = getCategories()
    .then((list) => {
      _cache = _buildMap(list);
      _subscribers.forEach((fn) => fn(_cache));
      return _cache;
    })
    .catch(() => {
      _cache = _cache || _buildMap([]);
      return _cache;
    })
    .finally(() => { _pending = null; });
  return _pending;
};

export const invalidateCategories = () => { _cache = null; };

// Hook: returns { categories, byName, getMeta(name), reload }.
export const useCategoryMeta = () => {
  const [state, setState] = useState(_cache || { list: [], byName: {} });

  useEffect(() => {
    let active = true;
    const onUpdate = (c) => { if (active) setState(c); };
    _subscribers.add(onUpdate);
    if (localStorage.getItem('access_token')) {
      loadCategories().then((c) => { if (active) setState(c); });
    }
    return () => { active = false; _subscribers.delete(onUpdate); };
  }, []);

  const getMeta = (name) => state.byName[name] || DEFAULT_META;
  const reload = () => loadCategories(true);
  return { categories: state.list, byName: state.byName, getMeta, reload };
};
