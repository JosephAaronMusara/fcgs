import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";

export function ResidentialAreaInput({
  defaultValue,
  name = "residentialArea",
  id = "residentialArea",
  placeholder = "e.g. Borrowdale, Mt Pleasant",
  "data-testid": testId = "input-residential-area",
}: {
  defaultValue?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  "data-testid"?: string;
}) {
  const [value, setValue] = useState(defaultValue || "");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const { data: areas } = useQuery<string[]>({
    queryKey: ["/api/residential-areas"],
  });

  const filtered = value.trim().length >= 1
    ? (areas || []).filter(a =>
        a.toLowerCase().includes(value.toLowerCase()) &&
        a.toLowerCase() !== value.toLowerCase()
      )
    : [];

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setShowSuggestions(true);
        }}
        onFocus={() => {
          if (value.trim().length >= 1) setShowSuggestions(true);
        }}
        onBlur={() => {
          setTimeout(() => setShowSuggestions(false), 200);
        }}
        data-testid={testId}
      />
      {showSuggestions && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-36 overflow-y-auto">
          {filtered.map((area) => (
            <div
              key={area}
              className="px-3 py-2 text-sm cursor-pointer hover-elevate"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setValue(area);
                setShowSuggestions(false);
              }}
              data-testid={`suggestion-area-${area.replace(/\s+/g, "-").toLowerCase()}`}
            >
              {area}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
