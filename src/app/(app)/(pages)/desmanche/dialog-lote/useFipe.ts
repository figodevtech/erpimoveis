import { useState, useCallback } from "react";
import axios from "axios";

export interface FipeItem {
  code: string;
  name: string;
}

export function getFipeTipo(tipoStr: string): string | null {
  const t = tipoStr.toUpperCase();
  if (t === "CARROS") return "cars";
  if (t === "MOTOS") return "motorcycles";
  if (t === "CAMINHOES") return "trucks";
  return null;
}

export function useFipe() {
  const [marcasFipe, setMarcasFipe] = useState<FipeItem[]>([]);
  const [modelosRaw, setModelosRaw] = useState<FipeItem[]>([]);
  const [anosFipe, setAnosFipe] = useState<FipeItem[]>([]);

  const [loadingMarcas, setLoadingMarcas] = useState(false);
  const [loadingModelos, setLoadingModelos] = useState(false);
  const [loadingAnos, setLoadingAnos] = useState(false);
  const [loadingPrice, setLoadingPrice] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const fetchReference = useCallback(async () => {
    try {
      const { data } = await axios.get("https://fipe.parallelum.com.br/api/v2/references");
      if (data && data.length > 0) {
        setReference(data[0].code);
        return data[0].code;
      }
    } catch (e) {
      console.error("Error fetching FIPE references", e);
    }
    return null;
  }, []);

  const fetchBrands = useCallback(async (tipo: string) => {
    const t = getFipeTipo(tipo);
    if (!t) return [];
    setLoadingMarcas(true);
    try {
      let ref = reference;
      if (!ref) ref = await fetchReference();
      
      const { data } = await axios.get(`https://fipe.parallelum.com.br/api/v2/${t}/brands`, {
        params: ref ? { reference: ref } : {}
      });
      setMarcasFipe(data);
      return data as FipeItem[];
    } catch (e) {
      console.error("Error fetching FIPE brands", e);
      return [];
    } finally {
      setLoadingMarcas(false);
    }
  }, [reference, fetchReference]);

  const fetchModels = useCallback(async (tipo: string, brandCode: string) => {
    const t = getFipeTipo(tipo);
    if (!t || !brandCode) return [];
    setLoadingModelos(true);
    try {
      let ref = reference;
      if (!ref) ref = await fetchReference();

      const { data } = await axios.get(`https://fipe.parallelum.com.br/api/v2/${t}/brands/${brandCode}/models`, {
        params: ref ? { reference: ref } : {}
      });
      setModelosRaw(data);
      return data as FipeItem[];
    } catch (e) {
      console.error("Error fetching FIPE models", e);
      return [];
    } finally {
      setLoadingModelos(false);
    }
  }, [reference, fetchReference]);

  const fetchYears = useCallback(async (tipo: string, brandCode: string, modelCode: string) => {
    const t = getFipeTipo(tipo);
    if (!t || !brandCode || !modelCode) return [];
    setLoadingAnos(true);
    try {
      let ref = reference;
      if (!ref) ref = await fetchReference();

      const { data } = await axios.get(`https://fipe.parallelum.com.br/api/v2/${t}/brands/${brandCode}/models/${modelCode}/years`, {
        params: ref ? { reference: ref } : {}
      });
      setAnosFipe(data);
      return data as FipeItem[];
    } catch (e) {
      console.error("Error fetching FIPE years", e);
      return [];
    } finally {
      setLoadingAnos(false);
    }
  }, [reference, fetchReference]);

  const fetchPrice = useCallback(async (tipo: string, brandCode: string, modelCode: string, yearCode: string) => {
    const t = getFipeTipo(tipo);
    if (!t || !brandCode || !modelCode || !yearCode) return null;
    setLoadingPrice(true);
    try {
      let ref = reference;
      if (!ref) ref = await fetchReference();

      const { data } = await axios.get(`https://fipe.parallelum.com.br/api/v2/${t}/brands/${brandCode}/models/${modelCode}/years/${yearCode}`, {
        params: ref ? { reference: ref } : {}
      });
      return data;
    } catch (e) {
      console.error("Error fetching FIPE price", e);
      return null;
    } finally {
      setLoadingPrice(false);
    }
  }, [reference, fetchReference]);

  const fetchYearsByBrand = useCallback(async (tipo: string, brandCode: string) => {
    const t = getFipeTipo(tipo);
    if (!t || !brandCode) return [];
    setLoadingAnos(true);
    try {
      let ref = reference;
      if (!ref) ref = await fetchReference();

      const { data } = await axios.get(`https://fipe.parallelum.com.br/api/v2/${t}/brands/${brandCode}/years`, {
        params: ref ? { reference: ref } : {}
      });
      setAnosFipe(data);
      return data as FipeItem[];
    } catch (e) {
      console.error("Error fetching FIPE years by brand", e);
      return [];
    } finally {
      setLoadingAnos(false);
    }
  }, [reference, fetchReference]);

  const fetchModelsByBrandAndYear = useCallback(async (tipo: string, brandCode: string, yearCode: string) => {
    const t = getFipeTipo(tipo);
    if (!t || !brandCode || !yearCode) return [];
    setLoadingModelos(true);
    try {
      let ref = reference;
      if (!ref) ref = await fetchReference();

      const { data } = await axios.get(`https://fipe.parallelum.com.br/api/v2/${t}/brands/${brandCode}/years/${yearCode}/models`, {
        params: ref ? { reference: ref } : {}
      });
      setModelosRaw(data);
      return data as FipeItem[];
    } catch (e) {
      console.error("Error fetching FIPE models by brand and year", e);
      return [];
    } finally {
      setLoadingModelos(false);
    }
  }, [reference, fetchReference]);

  return {
    marcasFipe,
    modelosRaw,
    anosFipe,
    setMarcasFipe,
    setModelosRaw,
    setAnosFipe,
    loadingMarcas,
    loadingModelos,
    loadingAnos,
    loadingPrice,
    fetchBrands,
    fetchModels,
    fetchYears,
    fetchYearsByBrand,
    fetchModelsByBrandAndYear,
    fetchPrice
  };
}
