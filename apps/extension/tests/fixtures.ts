/** Synthetic fixtures modelled on common list layouts. */
export const RESTAURANT_GRID = `
<header><nav><ul><li><a href="/">Home</a></li><li><a href="/search">Search</a></li><li><a href="/about">About us</a></li><li><a href="/help">Help</a></li></ul></nav></header>
<main>
  <h1>Best ramen in Brooklyn</h1>
  <form><input type="search" name="q" value="ramen"><input name="find_loc" value="Brooklyn, NY"></form>
  <div class="results" style="display:grid">
    <div class="card card-1001"><a href="https://www.resy.com/cities/ny/rintaro?date=2026"><img alt=""><h3>Rintaro</h3></a><p>Japanese · $$</p><span>82 Smith St</span><button>Save</button></div>
    <div class="card card-1002"><a href="/biz/ippudo"><h3>Ippudo</h3></a><p>Ramen · $$</p><span>65 4th Ave</span><button>Save</button></div>
    <div class="ad-slot">Sponsored placeholder</div>
    <div class="card card-1003"><a href="/biz/chuko"><h3>Chuko</h3></a><p>Ramen · $</p><span>565 Vanderbilt Ave</span><button>Save</button></div>
    <div class="card card-1004"><a href="/biz/okonomi"><h3>Okonomi</h3></a><p>Japanese · $$$</p><span>150 Ainslie St</span><button>Save</button></div>
  </div>
</main>
<footer><ul><li><a href="/terms">Terms</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/jobs">Jobs</a></li></ul></footer>`;

export const BOOK_LIST = `
<main>
  <h2>Books</h2>
  <ul class="list">
    <li><a href="/book/1"><b>The Overstory</b></a><div>Richard Powers</div><div>2018</div></li>
    <li><a href="/book/2"><b>Piranesi</b></a><div>Susanna Clarke</div><div>2020</div></li>
    <li><a href="/book/3"><b>Klara and the Sun</b></a><div>Kazuo Ishiguro</div><div>2021</div></li>
    <li><a href="/book/4"><b>Circe</b></a><div>Madeline Miller</div><div>2018</div></li>
    <li><a href="/book/5"><b>Pachinko</b></a><div>Min Jin Lee</div><div>2017</div></li>
  </ul>
</main>`;

export const ARTICLE = `
<nav><a href="/">Home</a><a href="/world">World</a><a href="/tech">Tech</a><a href="/sport">Sport</a></nav>
<article><h1>Something happened today</h1><p>A long paragraph of prose about the thing.</p><p>Another paragraph.</p></article>`;
