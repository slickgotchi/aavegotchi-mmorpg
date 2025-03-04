import { ethers } from 'ethers';

export interface Aavegotchi {
    id: number;
    name: string;
    modifiedNumericTraits: number[];
    withSetsRarityScore: number;
    svgs: { front: string; left: string; right: string; back: string };
}
/*
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
*/

export async function fetchAavegotchis(account: string): Promise<Aavegotchi[]> {
    const coreQuery = `
    query ($owner: String!) {
      aavegotchis(where: { owner: $owner }, first: 100) {
        id
        name
        modifiedNumericTraits
        withSetsRarityScore
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

    return coreData.data.aavegotchis.map((g: any) => ({
        id: Number(g.id),
        name: g.name,
        modifiedNumericTraits: g.modifiedNumericTraits.map(Number),
        withSetsRarityScore: g.withSetsRarityScore,
        svgs: {}
        // svgs: gotchisMap.get(g.id) || { front: '', left: '', right: '', back: '' },
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
        console.log(g.svg)
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
    let brs = 0;
    traits.forEach(trait => {
        if (trait < 50) {
            brs += (100 - trait);
        } else {
            brs += trait + 1;
        }
    });
    return brs;
}


export const removeBackgroundFromSVG = (svgString: string): string => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svg = doc.getElementsByTagName('svg')[0];

    // Helper function to find the background group (checking multiple possible classes)
    const findBackgroundGroup = (element: Element): Element | null => {
        // Check all <g> elements, including nested ones
        const groups = element.getElementsByTagName('g');
        for (const group of groups) {
            // Look for common background classes or patterns
            if (
                group.classList.contains('gotchi-bg') || // Original class
                group.classList.contains('wearable-bg') || // New class from your SVG
                group.classList.contains('gotchi-wearable') || // Parent class
                // Optionally, check for a large fill area or specific color (e.g., purple background)
                (group.querySelector('path[fill="#9325ee"]') &&
                    group.querySelector('path[d="M0 0v64h64V0H0"]')) // Large rectangle covering the entire viewBox
            ) {
                return group;
            }
        }
        return null;
    };

    // Search for the background in the top-level SVG and its nested SVGs
    let background: Element | null = findBackgroundGroup(svg);
    if (!background) {
        // Check nested <svg> elements (e.g., inside <g> elements)
        const nestedSvgs = svg.getElementsByTagName('svg');
        for (const nestedSvg of nestedSvgs) {
            background = findBackgroundGroup(nestedSvg);
            if (background) break;
        }
    }

    if (background && svg.contains(background)) {
        // If the background is nested inside another SVG, we need to handle it carefully
        const parent = background.parentElement;
        if (parent && parent.tagName.toLowerCase() === 'svg') {
            parent.removeChild(background);
        } else if (parent && parent.tagName.toLowerCase() === 'g') {
            parent.removeChild(background);
        } else {
            svg.removeChild(background);
        }
    } else {
        console.log('No background group found in SVG (checked gotchi-bg, wearable-bg, gotchi-wearable, or purple fill)');
    }

    // Ensure the SVG is valid and serialize it
    const serializer = new XMLSerializer();
    return serializer.serializeToString(svg);
};