import React from 'react';
import { Avatar } from '@mui/material';
import { getCategoryIconComponent, useCategoryMeta } from '../utils/categories';

// Renders a category's icon in its colored circle, resolved by category NAME.
export default function CategoryIcon({ name, size = 36, meta: metaProp }) {
  const { getMeta } = useCategoryMeta();
  const meta = metaProp || getMeta(name);
  const Icon = getCategoryIconComponent(meta.icon);
  return (
    <Avatar sx={{ bgcolor: meta.color || '#bab0ac', width: size, height: size }}>
      <Icon sx={{ fontSize: size * 0.55, color: '#fff' }} />
    </Avatar>
  );
}
