import { notFound } from 'next/navigation';
import { ListClient } from './ListClient';
import { listSlugs, loadList } from '@/lib/lists';

/**
 * Enumerating the slugs at build time both prerenders the routes and makes
 * Vercel trace the lists/*.json files into the deployment bundle.
 */
export async function generateStaticParams() {
  return (await listSlugs()).map((list) => ({ list }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ list: string }>;
}) {
  const { list } = await params;
  const data = await loadList(list);
  return data ? { title: `${data.name} · Trail Index` } : {};
}

export default async function ListPage({
  params,
}: {
  params: Promise<{ list: string }>;
}) {
  const { list } = await params;
  const seed = await loadList(list);
  if (!seed) notFound();
  return <ListClient slug={list} seed={seed} />;
}
