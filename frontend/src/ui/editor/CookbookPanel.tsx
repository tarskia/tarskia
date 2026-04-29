import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/button';
import type { SchemaCookbookRecipe } from './types';
import { COOKBOOK_CATEGORY_LABELS } from './types';

interface CookbookPanelProps {
  recipes: SchemaCookbookRecipe[];
  canInsert: boolean;
  disabledReason?: string;
  onInsertRecipe: (recipeId: string) => void;
}

export function CookbookPanel({
  recipes,
  canInsert,
  disabledReason,
  onInsertRecipe,
}: CookbookPanelProps) {
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | undefined>(
    () => recipes[0]?.id,
  );

  useEffect(() => {
    if (recipes.length === 0) {
      setSelectedRecipeId(undefined);
      return;
    }
    if (selectedRecipeId && recipes.some((r) => r.id === selectedRecipeId)) return;
    setSelectedRecipeId(recipes[0]?.id);
  }, [recipes, selectedRecipeId]);

  const cookbookGroups = useMemo(() => {
    const groups = new Map<string, SchemaCookbookRecipe[]>();
    for (const recipe of recipes) {
      const existing = groups.get(recipe.category);
      if (existing) existing.push(recipe);
      else groups.set(recipe.category, [recipe]);
    }
    return [...groups.entries()];
  }, [recipes]);

  const selectedRecipe = recipes.find((r) => r.id === selectedRecipeId) ?? recipes[0];

  return (
    <div className="flex flex-col gap-2.5 h-full min-h-0">
      <div className="text-base font-bold">Cookbook</div>
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <nav className="flex flex-col gap-2.5 shrink-0" aria-label="Cookbook recipes">
          {cookbookGroups.map(([category, groupRecipes]) => (
            <div key={category} className="flex flex-col gap-1.5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {COOKBOOK_CATEGORY_LABELS[category] ?? category}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groupRecipes.map((recipe) => (
                  <Button
                    key={recipe.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={`rounded-full border ${
                      recipe.id === selectedRecipe?.id
                        ? 'border-accent/42 bg-accent/16 hover:bg-accent/16'
                        : 'border-border bg-muted/30 hover:border-border/60'
                    }`}
                    onClick={() => setSelectedRecipeId(recipe.id)}
                  >
                    {recipe.title}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {selectedRecipe ? (
          <div className="flex flex-col gap-2.5 flex-1 min-h-0">
            <div className="flex flex-col gap-2 p-2.5 rounded-md border border-border bg-[rgba(8,10,16,0.45)] flex-1 min-h-0">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm font-bold">{selectedRecipe.title}</div>
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  {COOKBOOK_CATEGORY_LABELS[selectedRecipe.category] ?? selectedRecipe.category}
                </span>
              </div>
              <div className="text-sm leading-relaxed text-foreground/88">
                {selectedRecipe.description}
              </div>
              <pre className="m-0 p-2.5 rounded-md bg-[rgba(8,10,16,0.82)] border border-border text-xs leading-relaxed text-foreground/92 flex-1 min-h-0 overflow-auto whitespace-pre">
                <code>{selectedRecipe.previewText}</code>
              </pre>
            </div>
            <Button
              type="button"
              className="self-start"
              onClick={() => onInsertRecipe(selectedRecipe.id)}
              disabled={!canInsert}
            >
              Insert
            </Button>
          </div>
        ) : null}
      </div>
      {!canInsert && disabledReason ? (
        <div className="text-sm text-warning/90">{disabledReason}</div>
      ) : null}
    </div>
  );
}
