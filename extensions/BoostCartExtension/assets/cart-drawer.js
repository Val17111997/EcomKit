document.addEventListener('DOMContentLoaded', () => {
  const drawer = document.getElementById('my-cart-drawer');
  if (!drawer) return;
  
  // Récupération des paramètres depuis les data attributes du cart-drawer
  const freeShippingThreshold = parseFloat(drawer.dataset.freeShippingThreshold) || 69.0;
  const bonusThreshold = parseFloat(drawer.dataset.bonusThreshold) || 100.0;
  const bonusVariantId = drawer.dataset.bonusVariantId;

  // Fonction pour formater les prix en euros
  function formatMoney(cents) {
    return (cents / 100).toFixed(2).replace('.', ',') + '€';
  }

  // Fonction de mise à jour du contenu du drawer
  function updateDrawer(cart) {
    let content = '<div class="cart-items">';
    if (cart.items.length === 0) {
      content += '<p>Votre panier est vide.</p>';
    } else {
      cart.items.forEach(item => {
        content += `
          <div class="cart-item">
            <img src="${item.image}" width="50">
            <span>${item.product_title}</span>
            <span>${formatMoney(item.price)}</span>
          </div>`;
      });
    }
    content += '</div>';
    content += `<p class="total">Total : ${formatMoney(cart.total_price)}</p>`;
    drawer.innerHTML = content;
  }

  // Fonction pour gérer les bonus et les produits cadeaux
  function checkBonus(cart) {
    if (!bonusVariantId) return;
    
    const hasBonus = cart.items.some(item => item.variant_id == bonusVariantId);
    const shouldHaveBonus = cart.total_price >= (bonusThreshold * 100);
    
    if (shouldHaveBonus && !hasBonus) {
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bonusVariantId, quantity: 1 })
      }).then(() => fetchCart());
    } else if (!shouldHaveBonus && hasBonus) {
      const lineToRemove = cart.items.find(i => i.variant_id == bonusVariantId);
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: lineToRemove.key, quantity: 0 })
      }).then(() => fetchCart());
    }
  }

  // Fonction de mise à jour de la barre de progression (livraison gratuite et bonus)
  function updateProgressBar(cart) {
    const progressBar = document.querySelector('.progress-bar');
    if (!progressBar) return;

    const ratio = Math.min(cart.total_price / (bonusThreshold * 100), 1) * 100;
    progressBar.style.width = ratio + '%';

    const shippingText = document.querySelector('.progress-text-shipping');
    const shippingDiff = freeShippingThreshold * 100 - cart.total_price;

    if (shippingDiff > 0) {
      shippingText.textContent = `Encore ${formatMoney(shippingDiff)} pour livraison offerte`;
      shippingText.classList.remove('success');
    } else {
      shippingText.textContent = 'Livraison gratuite débloquée !';
      shippingText.classList.add('success');
    }

    const bonusText = document.querySelector('.progress-text-bonus');
    const bonusDiff = bonusThreshold * 100 - cart.total_price;

    if (bonusDiff > 0) {
      bonusText.textContent = `Encore ${formatMoney(bonusDiff)} pour le cadeau offert`;
      bonusText.classList.remove('success');
    } else {
      bonusText.textContent = 'Cadeau offert débloqué !';
      bonusText.classList.add('success');
    }
  }

  // Fonction pour récupérer les données du panier via AJAX
  function fetchCart() {
    fetch('/cart.js')
      .then(response => response.json())
      .then(cart => {
        updateDrawer(cart);
        checkBonus(cart);
        updateProgressBar(cart);
      })
      .catch(err => console.error('Erreur panier AJAX', err));
  }

  // Initialisation et écoute des événements de mise à jour du panier
  fetchCart();
  document.body.addEventListener('cart:refresh', fetchCart);

  // Gestion de l'affichage du cart drawer
  const toggleButton = document.getElementById('cart-drawer-toggle');
  if (toggleButton) {
    toggleButton.addEventListener('click', (e) => {
      e.preventDefault();
      drawer.style.display = (drawer.style.display === 'block') ? 'none' : 'block';
    });
  }

  // Fermeture du drawer si le clic se fait à l'extérieur du cart drawer ou du bouton toggle
  document.addEventListener('click', (e) => {
    if (drawer && !drawer.contains(e.target) && !e.target.closest('#cart-drawer-toggle')) {
      drawer.style.display = 'none';
    }
  });
});
