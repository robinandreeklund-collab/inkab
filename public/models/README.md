# Webbmodeller

GLB-filer framtagna av `scripts/step-to-glb.mjs` ur maskinernas STEP-filer.

`exempel.glb` är genererad ur en publik CAx-IF-testmodell och finns här för
att visa att kedjan fungerar. Klistra in `/models/exempel.glb` i fältet
**GLB** på valfri maskin i admin, byt till vyn **Modell**, och den dyker upp
i hallen — tillsammans med en varning om att modellens mått inte stämmer med
bibliotekets, eftersom testmodellen är 0,2 m stor. Det är kontrollen som
avses: 3D-vyn granskar datan, den pyntar den inte.

I skarp drift hör de här filerna hemma i objektlagring (Cloudflare R2 eller
S3), inte i git. Katalogkortet bär då en URL i stället för en sökväg.
