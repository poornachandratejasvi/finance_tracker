import { Ionicons } from "@expo/vector-icons";

// Maps the icon KEY stored on a Category (frontend/src/utils/categories.js's
// CATEGORY_ICONS, MUI icon component names) to the closest Ionicons
// equivalent, so a transaction/budget row can show a real category icon
// instead of a plain letter badge -- same data, no backend change needed.
// Unmapped/unknown keys fall back to a generic tag icon.
const CATEGORY_ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Restaurant: "restaurant-outline",
  ShoppingBag: "bag-outline",
  DirectionsBus: "bus-outline",
  ReceiptLong: "receipt-outline",
  Movie: "film-outline",
  LocalHospital: "medkit-outline",
  LocalAtm: "cash-outline",
  TrendingUp: "trending-up-outline",
  SwapHoriz: "swap-horizontal-outline",
  Payments: "card-outline",
  MoreHoriz: "ellipsis-horizontal-outline",
  HelpOutline: "help-circle-outline",
  Category: "pricetag-outline",
  Home: "home-outline",
  DirectionsCar: "car-outline",
  Flight: "airplane-outline",
  Pets: "paw-outline",
  School: "school-outline",
  FitnessCenter: "barbell-outline",
  Fastfood: "fast-food-outline",
  LocalGroceryStore: "cart-outline",
  Bolt: "flash-outline",
  Phone: "call-outline",
  Savings: "wallet-outline",
  CardGiftcard: "gift-outline",
  LocalCafe: "cafe-outline",
  Checkroom: "shirt-outline",
  Spa: "flower-outline",
  SportsEsports: "game-controller-outline",
  Work: "briefcase-outline",
  Wifi: "wifi-outline",
  WaterDrop: "water-outline",
  Celebration: "sparkles-outline",
  ChildCare: "happy-outline",
};

export function categoryIconFor(iconKey: string | null | undefined): keyof typeof Ionicons.glyphMap {
  if (!iconKey) return "pricetag-outline";
  return CATEGORY_ICON_MAP[iconKey] || "pricetag-outline";
}
