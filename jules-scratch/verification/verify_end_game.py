import asyncio
from playwright.async_api import async_playwright, expect
import os

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Obtenez le chemin absolu vers le fichier index.html
        file_path = os.path.abspath('index.html')

        # Allez à la page locale et attendez que les requêtes réseau soient terminées
        await page.goto(f'file://{file_path}', wait_until='networkidle')

        # Simuler un état de jeu minimal pour que endGame fonctionne
        await page.evaluate('''() => {
            window.gameOver = false;
            window.gameRef = { once: () => Promise.resolve({ val: () => ({ players: { black: { nickname: 'Joueur 1' }, white: { nickname: 'Joueur 2' } } }) }) };
            window.board = Array.from({ length: 19 }, () => Array(19).fill(0));
        }''')

        # Appeler la fonction endGame pour déclencher l'overlay
        await page.evaluate("endGame('Le joueur Noir gagne par abandon.')")

        # Attendre que l'overlay de fin de partie soit visible
        end_game_overlay = page.locator("#endGameOverlay")
        await expect(end_game_overlay).to_be_visible()

        # Vérifier que le message de victoire est correct
        end_game_message = page.locator("#endGameMessage")
        await expect(end_game_message).to_have_text('Le joueur Noir gagne par abandon.')

        # Prendre une capture d'écran de la bannière
        screenshot_path = 'jules-scratch/verification/verification.png'
        await page.screenshot(path=screenshot_path)
        print(f"Screenshot saved to {screenshot_path}")

        # Attendre que l'animation se termine et que le lobby soit visible
        lobby_screen = page.locator("#lobbyScreen")
        await expect(lobby_screen).to_be_visible(timeout=7000)

        await browser.close()

if __name__ == '__main__':
    asyncio.run(main())
