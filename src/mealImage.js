export function mealImage(meal) {
  const value = meal?.image || "";
  if (/^photo-[a-zA-Z0-9-]+$/.test(value))
    return `https://images.unsplash.com/${value}?auto=format&fit=crop&w=800&q=85`;
  if (/^https?:\/\//i.test(value) || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(value)) return value;
  return null;
}
