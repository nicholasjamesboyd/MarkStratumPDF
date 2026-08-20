type BrandMarkProps = {
  size?: number
  className?: string
}

export function BrandMark({ size = 16, className }: BrandMarkProps) {
  return (
    <img
      className={className}
      src={`${import.meta.env.BASE_URL}icon-256.png`}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      draggable={false}
    />
  )
}
