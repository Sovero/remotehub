import { describe, expect, it } from 'vitest';
import {
  applyImport,
  buildExport,
  collectTags,
  countHosts,
  duplicateHost,
  filterTree,
  findNode,
  findParent,
  flattenHosts,
  insertNode,
  matchesHostQuery,
  moveNode,
  parseProfileExport,
  removeNode,
  replaceNode
} from '../src/shared/tree';
import { createGroup, createHost } from '../src/shared/types';

function sample(): ReturnType<typeof createGroup> {
  return createGroup({
    id: 'g1',
    name: 'Серверы',
    children: [
      createHost({ id: 'h1', name: 'Prod', protocol: 'ssh', host: '10.0.0.1', tags: ['prod'] }),
      createGroup({
        id: 'g2',
        name: 'Тест',
        children: [createHost({ id: 'h2', name: 'Dev', protocol: 'rdp', host: 'dev.local' })]
      })
    ]
  });
}

describe('find/insert/remove', () => {
  it('находит узел и родителя', () => {
    const tree = [sample()];
    expect(findNode(tree, 'h2')?.id).toBe('h2');
    expect(findParent(tree, 'h2')?.id).toBe('g2');
    expect(findParent(tree, 'h1')?.id).toBe('g1');
    expect(findParent(tree, 'g1')).toBeNull();
  });

  it('вставляет в группу и в корень', () => {
    const tree = [sample()];
    const host = createHost({ id: 'h3', name: 'New', protocol: 'ssh', host: 'n' });
    const intoGroup = insertNode(tree, host, 'g2');
    expect(findParent(intoGroup, 'h3')?.id).toBe('g2');

    const host2 = createHost({ id: 'h4', name: 'Root', protocol: 'ssh', host: 'r' });
    const intoRoot = insertNode(intoGroup, host2, null);
    expect(findParent(intoRoot, 'h4')).toBeNull();
  });

  it('удаляет узел с поддеревом', () => {
    const tree = [sample()];
    const after = removeNode(tree, 'g2');
    expect(findNode(after, 'g2')).toBeNull();
    expect(findNode(after, 'h2')).toBeNull();
    expect(findNode(after, 'h1')).not.toBeNull();
  });

  it('replaceNode обновляет узел по id', () => {
    const tree = [sample()];
    const after = replaceNode(tree, 'h1', { ...findNode(tree, 'h1')!, name: 'Prod2' } as never);
    expect(findNode(after, 'h1')?.name).toBe('Prod2');
  });
});

describe('moveNode', () => {
  it('переносит хост в другую группу', () => {
    const tree = [sample()];
    const after = moveNode(tree, 'h1', 'g2');
    expect(findParent(after, 'h1')?.id).toBe('g2');
    expect(findNode(after, 'g1')?.children).toHaveLength(1);
  });

  it('переносит группу с поддеревом в корень', () => {
    const tree = [sample()];
    const after = moveNode(tree, 'g2', null);
    expect(findParent(after, 'g2')).toBeNull();
    expect(findNode(after, 'h2')).not.toBeNull();
  });

  it('не даёт перенести группу внутрь собственного поддерева', () => {
    const tree = [sample()];
    const after = moveNode(tree, 'g1', 'g2');
    expect(after).toEqual(tree);
  });

  it('вставляет после указанного узла', () => {
    const tree = [sample()];
    const host = createHost({ id: 'h5', name: 'Mid', protocol: 'ssh', host: 'm' });
    const withHost = insertNode(tree, host, 'g1');
    const after = moveNode(withHost, 'h5', 'g1', 'h1');
    const g1 = findNode(after, 'g1')!;
    expect(g1.children.map((c) => c.id)).toEqual(['h1', 'h5', 'g2']);
  });
});

describe('filter/search/tags', () => {
  it('фильтрует по имени хоста, сохраняя группы-предков', () => {
    const tree = [sample()];
    const filtered = filterTree(tree, (n) => n.kind === 'host' && n.name.includes('Dev'));
    expect(filtered).toHaveLength(1);
    const g1 = filtered[0] as ReturnType<typeof createGroup>;
    expect(g1.children.map((c) => c.id)).toEqual(['g2']);
  });

  it('matchesHostQuery учитывает имя, адрес и теги', () => {
    const host = createHost({ id: 'h', name: 'Prod', protocol: 'ssh', host: '10.0.0.1', tags: ['prod', 'linux'] });
    expect(matchesHostQuery(host, 'prod', null)).toBe(true);
    expect(matchesHostQuery(host, '10.0.0', null)).toBe(true);
    expect(matchesHostQuery(host, 'linux', null)).toBe(true);
    expect(matchesHostQuery(host, 'window', null)).toBe(false);
    expect(matchesHostQuery(host, '', 'linux')).toBe(true);
    expect(matchesHostQuery(host, '', 'db')).toBe(false);
  });

  it('собирает уникальные теги', () => {
    const tree = [sample()];
    expect(collectTags(tree)).toEqual(['prod']);
  });

  it('countHosts считает хосты в поддереве', () => {
    expect(countHosts(sample())).toBe(2);
    expect(countHosts(createHost({ id: 'x', name: 'X', protocol: 'ssh', host: 'x' }))).toBe(1);
  });

  it('duplicateHost создаёт копию с новым id и суффиксом', () => {
    const host = createHost({ id: 'h1', name: 'Prod', protocol: 'ssh', host: '10.0.0.1' });
    const copy = duplicateHost(host);
    expect(copy.id).not.toBe('h1');
    expect(copy.name).toBe('Prod (копия)');
    expect(copy.host).toBe('10.0.0.1');
  });
});

describe('export/import', () => {
  it('buildExport/parseProfileExport — круг', () => {
    const tree = [sample()];
    const raw = buildExport(tree);
    const res = parseProfileExport(raw);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.tree).toEqual(tree);
  });

  it('отвергает не-JSON и не-профильные файлы', () => {
    expect(parseProfileExport('not json').ok).toBe(false);
    expect(parseProfileExport(JSON.stringify({ hello: 1 })).ok).toBe(false);
    expect(parseProfileExport(JSON.stringify({ app: 'other', version: 1, tree: [] })).ok).toBe(false);
  });

  it('отвергает дерево с дубликатами и неверными узлами', () => {
    const dup = JSON.stringify({
      app: 'remote-hub',
      version: 1,
      tree: [
        createHost({ id: 'a', name: 'A', protocol: 'ssh', host: 'a' }),
        createHost({ id: 'a', name: 'B', protocol: 'ssh', host: 'b' })
      ]
    });
    expect(parseProfileExport(dup).ok).toBe(false);
    const bad = JSON.stringify({ app: 'remote-hub', version: 1, tree: [{ id: 'x', kind: 'host', name: 'A', protocol: 'http', host: 'a' }] });
    expect(parseProfileExport(bad).ok).toBe(false);
  });

  it('applyImport replace заменяет дерево, merge дополняет и переименовывает конфликтующие id', () => {
    const current = [createHost({ id: 'h1', name: 'Old', protocol: 'ssh', host: 'o' })];
    const incoming = [createHost({ id: 'h1', name: 'New', protocol: 'ssh', host: 'n' })];

    const replaced = applyImport(current, incoming, 'replace');
    expect(replaced).toEqual(incoming);

    const merged = applyImport(current, incoming, 'merge');
    expect(merged).toHaveLength(2);
    const ids = merged.map((n) => n.id);
    expect(ids[0]).toBe('h1');
    expect(ids[1]).not.toBe('h1');
  });
});

describe('flattenHosts', () => {
  it('возвращает всех хостов независимо от вложенности', () => {
    const tree = [sample()];
    expect(flattenHosts(tree).map((h) => h.id).sort()).toEqual(['h1', 'h2']);
  });
});
