import { ethers } from 'ethers';

export interface Aavegotchi {
    id: number;
    name: string;
    modifiedNumericTraits: number[];
    svgs: { front: string; left: string; right: string; back: string };
}

export const removeBackgroundFromSVG = (svgString: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.getElementsByTagName('svg')[0];

    const groups = svg.getElementsByTagName('g');
    let background: Element | undefined;
    for (const group of groups) {
        if (group.classList.contains('gotchi-bg')) {
            background = group;
            break;
        }
    }

    if (background && svg.contains(background)) {
        svg.removeChild(background);
    } else {
        console.log('No "gotchi-bg" group found in SVG');
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(svg);
};

export async function fetchAavegotchis(account: string): Promise<Aavegotchi[]> {
    const coreQuery = `
    query ($owner: String!) {
      aavegotchis(where: { owner: $owner }, first: 100) {
        id
        name
        modifiedNumericTraits
      }
    }
  `;
    const coreResponse = await fetch('https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-core-matic/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: coreQuery,
            variables: { owner: account.toLowerCase() },
        }),
    });
    if (!coreResponse.ok) {
        throw new Error(`Core subgraph request failed: ${coreResponse.status} ${coreResponse.statusText}`);
    }
    const coreData = await coreResponse.json();
    if (!coreData?.data?.aavegotchis) {
        throw new Error('No Aavegotchis found in core subgraph');
    }

    const svgQuery = `
    query ($ids: [ID!]!) {
      aavegotchis(where: { id_in: $ids }) {
        id
        svg
        left
        right
        back
      }
    }
  `;
    const ids = coreData.data.aavegotchis.map((g: any) => g.id);
    const svgResponse = await fetch('https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-svg-matic/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: svgQuery,
            variables: { ids },
        }),
    });
    if (!svgResponse.ok) {
        throw new Error(`SVG subgraph request failed: ${svgResponse.status} ${svgResponse.statusText}`);
    }
    const svgData = await svgResponse.json();
    if (!svgData?.data?.aavegotchis) {
        throw new Error('No SVG data found in SVG subgraph');
    }

    const gotchisMap = new Map(svgData.data.aavegotchis.map((g: any) => [g.id, {
        front: removeBackgroundFromSVG(g.svg),
        left: removeBackgroundFromSVG(g.left || g.svg),
        right: removeBackgroundFromSVG(g.right || g.svg),
        back: removeBackgroundFromSVG(g.back || g.svg),
    }]));

    return coreData.data.aavegotchis.map((g: any) => ({
        id: Number(g.id),
        name: g.name,
        modifiedNumericTraits: g.modifiedNumericTraits.map(Number),
        svgs: gotchisMap.get(g.id) || { front: '', left: '', right: '', back: '' },
    }));
}

// New function to fetch all SVGs for a single Gotchi ID
export async function fetchGotchiSVGs(gotchiID: string): Promise<{ front: string; left: string; right: string; back: string }> {
    const svgQuery = `
    query ($id: ID!) {
      aavegotchi(id: $id) {
        svg
        left
        right
        back
      }
    }
  `;
    const response = await fetch('https://subgraph.satsuma-prod.com/tWYl5n5y04oz/aavegotchi/aavegotchi-svg-matic/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            query: svgQuery,
            variables: { id: gotchiID },
        }),
    });
    if (!response.ok) {
        throw new Error(`SVG subgraph request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    // console.log(`SVG fetch response for ${gotchiID}:`, JSON.stringify(data));
    if (data?.data?.aavegotchi) {
        const g = data.data.aavegotchi;
        return {
            front: removeBackgroundFromSVG(g.svg),
            left: removeBackgroundFromSVG(g.left || g.svg),
            right: removeBackgroundFromSVG(g.right || g.svg),
            back: removeBackgroundFromSVG(g.back || g.svg),
        };
    } else {
        console.error(`No SVGs found for Gotchi ID ${gotchiID}`);
        return { front: '', left: '', right: '', back: '' }; // Fallback to empty strings—handled by placeholder in GameScene
    }
}

export function calculateBRS(traits: number[]): number {
    return traits.reduce((sum, trait) => sum + trait, 0);
}