import { useEffect, useState } from "react";

export const isMounted = () => {
    const [mounted, setMounted] = useState(false);

    useEffect(()=>{
        setMounted(true);
    },[])
    return mounted;
}