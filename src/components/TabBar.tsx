'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'My Runners' },
  { href: '/search', label: 'Add' },
  { href: '/crit', label: 'CRIT' },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="tab"
          data-active={pathname === tab.href}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
